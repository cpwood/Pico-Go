'use babel';
let fs = require('fs');
import Logger from '../helpers/logger.js';
import ShellWorkers from './shell-workers.js';
import ApiWrapper from '../main/api-wrapper.js';
import Utils from '../helpers/utils.js';
import Config from '../config.js';
let crypto = require('crypto');
let exec = require('child_process').exec;
let path = require('path');
import FileWriter from './file-writer.js';

export default class Shell {

  constructor(pyboard,method,settings){
    this.config = Config.constants();
    this.settings = settings;
    this.BIN_CHUNK_SIZE = this.settings.upload_chunk_size;
    this.EOF = '\x04'; // reset (ctrl-d)
    this.RETRIES = 2;
    this.pyboard = pyboard;
    this.api = new ApiWrapper();
    this.logger = new Logger('Shell');
    this.workers = new ShellWorkers(this,pyboard,settings);
    this.utils = new Utils(settings);
    this.lib_folder = this.api.getPackageSrcPath();
    this.package_folder = this.api.getPackagePath();
    this.mcu_root_folder = '/';
    this.working = false;
    this.interrupt_cb = null;
    this.interrupted = false;
  }

  initialise(cb) {
    this.logger.silly('Try to enter raw mode');

    // 3 = RAW_REPL
    if (this.pyboard.status != 3) {
      this.pyboard.enter_raw_repl_no_reset(function(err){
        if(err){
          cb(err);
        }
  
        cb(null);
      });
    }
    else {
      cb(null);
    }
  }

  getFreeSpace(cb){
      let command =
          'import os, sys\r\n' +
          "_s = os.statvfs('"+ this.mcu_root_folder +"')\r\n" +
          'sys.stdout.write(str(s[0]*s[3])\r\n' +
          'del(_s)\r\n';

    this.pyboard.exec_(command,function(err,content){
      cb(content);
    });
  }

  async getFreeSpaceAsync(){
    let command =
        'import os, sys\r\n' +
        "_s = os.statvfs('"+ this.mcu_root_folder +"')\r\n" +
        'sys.stdout.write(str(s[0]*s[3])\r\n' +
        'del(_s)\r\n';

    return await this.pyboard.xxSendWait(command);
}

  decompress(name,execute,cb){
    if(!execute){
      cb();
      return;
    }
    let command =
        'import uzlib\r\n' +
        'def decompress(name):\r\n' +
        "  with open(name,'r+') as d:\r\n" +
        '    c = uzlib.decompress(d.read())\r\n' +
        "  with open(name,'w') as d:\r\n" +
        '      d.write(c)\r\n' +
        '  del(c)\r\n' +
        "decompress('"+name+"')\r\n";

    this.pyboard.exec_(command,function(err,content){
      cb(content);
    },40000);
  }

  async decompressAsync(name){
    let command =
        'import uzlib\r\n' +
        'def decompress(name):\r\n' +
        "  with open(name,'r+') as d:\r\n" +
        '    c = uzlib.decompress(d.read())\r\n' +
        "  with open(name,'w') as d:\r\n" +
        '      d.write(c)\r\n' +
        '  del(c)\r\n' +
        "decompress('"+name+"')\r\n";

    await this.pyboard.xxSendWait(command, null, 40000);
  }

  compress(filepath,name,cb){

    let name_only = name.substr(name.lastIndexOf('/') + 1);
    let zipped_path = filepath.replace(name,this.config.compressed_files_folder + '/');
    let zipped_filepath = zipped_path+name_only+'.gz';

    this.utils.ensureDirectoryExistence(zipped_path);

    exec('python '+this.package_folder+'/scripts/compress.py "'+filepath+'" "'+zipped_filepath+'"',
      function(error,stdout,stderr){
        cb(error,stdout,zipped_filepath);
      }
    );
  }

  writeFile(name,file_path,contents,compare_hash,compress,callback,retries=0){
    this.writeFileAsync(name, file_path, contents, compare_hash, compress, retries)
      .then(() => {
        if (callback) callback();
      })
      .catch(err => {
        if (callback) callback(err);
      });
  }

  async writeFileAsync(name,file_path,contents,compare_hash,compress,retries=0){
    let fw = new FileWriter(this, this.pyboard, this.settings, this.api);
    // let hash = '';
    // if (compare_hash)
    //   hash = await this.getHashAsync(file_path);
    await fw.writeFileContent(name, file_path, contents, 0);
  }

  ensureDirectory(fullPath, cb) {
    if (fullPath == undefined || fullPath == null) {
      return;
    }

    let parts = fullPath.split(path.sep);
    let _this = this;

    // Remove filename
    parts.pop();

    if (parts.length == 0) {
      cb();
      return;
    }

    let command =   'import os\r\n' +
                    'def ensureFolder(folder):\r\n' +
                    '   try:\r\n' +
                    '     os.mkdir(folder)\r\n' +
                    '   except OSError:\r\n' +
                    '     ...\r\n' +
                    '\r\n';

    for(let i=1; i <= parts.length; i++) {
      command += `ensureFolder("${parts.slice(0, i).join('/')}")\r\n`;
    }

    _this.eval(command,function(err,content){
      cb();
    });
  }

  async ensureDirectoryAsync(fullPath) {
    if (fullPath == undefined || fullPath == null) {
      return;
    }

    let parts = fullPath.split(path.sep);

    // Remove filename
    parts.pop();

    if (parts.length == 0) {
      return;
    }

    let command =   'import os\r\n' +
                    'def ensureFolder(folder):\r\n' +
                    '   try:\r\n' +
                    '     os.mkdir(folder)\r\n' +
                    '   except OSError:\r\n' +
                    '     ...\r\n' +
                    '\r\n';

    for(let i=1; i <= parts.length; i++) {
      command += `ensureFolder("${parts.slice(0, i).join('/')}")\r\n`;
    }

    await this.pyboard.xxSendWait(command, null, 30000);
  }

  readFile(name,callback){
    let _this = this;

    _this.working = true;

    let cb = function(err,content_buffer,content_str){
      setTimeout(function(){
        _this.working = false;
        callback(err,content_buffer,content_str);
      },100);
    };

    // avoid leaking file handles 
    let command;
    command = 'import ubinascii,sys' + '\r\n' + 
            "with open('"+name+"', 'rb') as f:" + '\r\n' + 
            '  while True:' + '\r\n' + 
            '    c = ubinascii.b2a_base64(f.read('+_this.BIN_CHUNK_SIZE+'))' + '\r\n' + 
            '    sys.stdout.write(c)' + '\r\n' + 
            "    if not len(c) or c == b'\\n':" + '\r\n' + 
            '        break\r\n';
  
            _this.pyboard.exec_raw(command,function(err,content){

      // Workaround for the "OK" return of soft reset, which is sometimes returned with the content
      if(content.indexOf('OK') == 0){
        content = content.slice(2,content.length);
      }
      // Did an error occur 
      if (content.includes('Traceback (')) {
        // some type of error
        _this.logger.silly('Traceback error reading file contents: '+ content);
        // pass the error back
        cb(content,null ,null);
        return;
      }

      let decode_result = _this.utils.base64decode(content);
      let content_buffer = decode_result[1];
      let content_str = decode_result[0].toString();

      if(err){
        _this.logger.silly('Error after executing read');
        _this.logger.silly(err);
      }
      cb(err,content_buffer,content_str);
    },60000);
  }
  // list files on MCU 
  list_files(cb){
    let _this = this;
    let file_list = [''];

    let end = function(err,file_list_2){
      // return no error, and the retrieved file_list
      cb(undefined,file_list);
    };

    let worker = function(params,callback){
      if(_this.interrupted){
        _this.interrupt_cb();
        return;
      }
      _this.workers.list_files(params,callback);
    };
    // need to determine what the root folder of the board is
    _this.utils.doRecursively([_this.mcu_root_folder,[''],file_list], worker ,end);
  }

  board_ready(cb){
    let _this = this;
    let command =
        'import sys\r\n' +
        "sys.stdout.write('OK')\r\n";
    this.eval(command,cb,25000);
  }


  removeFile(name,cb){
    let _this = this;
    let command =
        'import os\r\n' +
        "os.remove('"+name+"')\r\n";

        _this.eval(command,function(err,content){
          cb(err,content);
        });
  }

  createDir(name,cb){
    let _this = this;
    let command =
        'import os\r\n' +
        "os.mkdir('"+name+"')\r\n";
        _this.eval(command,function(err,content){
          cb(err,content);
        });
  }

  changeDir(name,cb){
    let _this = this;
    let command =
        'import os\r\n' +
        "os.chdir('"+name+"')\r\n";
        _this.eval(command,function(err,content){
          cb(err,content);
        });
  }

  removeDir(name,cb){
    let _this = this;
    let command =
        'import os\r\n' +
        "os.rmdir('"+name+"')\r\n";
        _this.eval(command,function(err,content){
          cb(err,content);
        });
  }

  reset(cb){
    let _this = this;
    let command =
        'import machine\r\n' +
        'machine.reset()\r\n';
    
    // Hard reset is as above
    //this.pyboard.exec_raw_no_reset(command,function(err){
    this.pyboard.xxSend(command)
    .then(() => {
      // Soft reset isn't actually a soft reset; it's just
      // that the same key combination (Ctrl+D) is used to 
      // execute the above code in Raw REPL.
      _this.pyboard.soft_reset_no_follow(cb);
    });
  }

  safeboot_restart(cb){
    let _this = this;
    this.pyboard.safe_boot(function(){
      _this.pyboard.enter_raw_repl_no_reset(cb);
    },4000);

  }

  get_version(cb){
    let _this = this;
    let command = 'import os; os.uname().release\r\n';

    this.eval(command,function(err,content){
      let version = content.replace(command,'').replace(/>>>/g,'').replace(/'/g,'').replace(/\r\n/g,'').trim();
      let version_int = _this.utils.calculateIntVersion(version);
      if(version_int == 0 || isNaN(version_int)){
        err = new Error('Error retrieving version number');
      }else{
        err = undefined;
      }
      cb(err,version_int,version);
    });
  }

  compare_hash(filename,file_path,content_buffer,cb){
    let _this = this;

    let compare = function(local_hash){
      _this.get_hash(filename,function(err,remote_hash){
        _this.logger.silly('Comparing local hash to remote hash');
        _this.logger.silly('local: '+local_hash);
        _this.logger.silly('remote: '+remote_hash);
        cb(local_hash == remote_hash,err);
      });
    };
    // the file you want to get the hash
    if(file_path){
      let fd = fs.createReadStream(file_path);
      let hash = crypto.createHash('sha256');
      hash.setEncoding('hex');

      fd.on('end', function() {
          hash.end();
          let local_hash = hash.read();
          compare(local_hash);
      });
      fd.pipe(hash);
    }else{
      let local_hash = crypto.createHash('sha256').update(content_buffer.toString()).digest('hex');
      compare(local_hash);
    }
  }

  get_hash(filename,cb){
    let _this = this;

    let command =
        'import uhashlib,ubinascii,sys\r\n' +
        'hash = uhashlib.sha256()\r\n' +
        "with open('"+filename+"', 'rb') as f:\r\n"+
        '  while True:\r\n'+
        '    c = f.read('+this.BIN_CHUNK_SIZE+')\r\n'+
        '    if not c:\r\n'+
        '       break\r\n'+
        '    hash.update(c)\r\n'+
        'sys.stdout.write(ubinascii.hexlify(hash.digest()))\r\n';

    this.eval(command,function(err,content){
      content = content.slice(2,-3).replace('>','');
      if(err){
        _this.logger.silly('Error after reading hash:');
        _this.logger.silly(err);
      }
      _this.logger.silly('Returned content from hash:');
      _this.logger.silly(content);
      cb(err,content);
    },40000);
  }

  // evaluates command through REPL and returns the resulting feedback
  eval(c,cb,timeout){
    let _this = this;
    let command =
        c+'\r\n';

    this.pyboard.exec_raw(command,function(err,content){
      if(!err){
        err = _this.utils.parse_error(content);
      }
      if(err){
        _this.logger.error(err.message);
      }
      setTimeout(function(){
          cb(err,content);
      },100);

    },timeout);
  }

  exit(cb){
    let _this = this;
    this.stop_working(function(){
      _this.__clean_close(cb);
    });
  }

  stop_working(cb){
    let _this = this;
    if(this.working){
      _this.logger.info('Exiting shell while still working, doing interrupt');
      let cb_done = false;
      this.interrupt_cb = function(){
        cb_done = true;
        _this.working = false;
        _this.interrupted = false;
        _this.interrupt_cb = null;
        _this.logger.info('Interrupt done, closing');
        cb();
      };
      this.interrupted = true;
      setTimeout(function(){
        if(!cb_done){
          _this.logger.info('Interrupt timed out, continuing anyway');
          cb();
        }
      },1000);
    }else{
      _this.logger.info('Not working, continuing closing');
      cb();
    }
  }

  __clean_close(cb){
    let _this = this;
    _this.logger.info('Closing shell cleanly');

    let finish = function(err){
      _this.logger.info('Closed successfully');
      if(_this.pyboard.connection.type != 'serial'){
        _this.pyboard.disconnect_silent();
      }
      if(cb){
        _this.logger.info('Callbacking outa here');
        cb(err);
      }else{
        _this.logger.info('No callback?!? Ok, whatevs');
      }
    };

    if(this.settings.reboot_after_upload){
      _this.logger.info('Rebooting after upload');
      this.reset(finish);
    }else{
      this.pyboard.enter_friendly_repl(function(err){
        _this.pyboard.send('\r\n');
        finish(err);
      });
    }
  }
}
