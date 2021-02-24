'use babel';

import Logger from '../helpers/logger.js';
import ShellWorkers from './shell-workers.js';
import ApiWrapper from '../main/api-wrapper.js';
import Utils from '../helpers/utils.js';
import Config from '../config.js';
import { exec } from 'child_process';
import path from 'path';
import FileWriter from './file-writer.js';

export default class Shell {

  constructor(pyboard, method, settings) {
    this.config = Config.constants();
    this.settings = settings;
    this.BIN_CHUNK_SIZE = this.settings.upload_chunk_size;
    this.EOF = '\x04'; // reset (ctrl-d)
    this.RETRIES = 2;
    this.pyboard = pyboard;
    this.api = new ApiWrapper();
    this.logger = new Logger('Shell');
    this.workers = new ShellWorkers(this, pyboard, settings);
    this.utils = new Utils(settings);
    this.lib_folder = this.api.getPackageSrcPath();
    this.package_folder = this.api.getPackagePath();
    this.mcu_root_folder = '/';
    this.working = false;
    this.interrupt_cb = null;
    this.interrupted = false;
  }

  initialise(cb) {
    this.initialiseAsync()
      .then(() => {
        if (cb) cb();
      })
      .catch(err => {
        if (cb) cb(err);
      });
  }
  
  async initialiseAsync() {
    this.logger.silly('Try to enter raw mode');

    // 3 = RAW_REPL
    if (this.pyboard.status != 3) {
      await this.pyboard.enterRawReplNoResetAsync();
    }
  }

  getFreeSpace(cb) {
    this.getFreeSpaceAsync()
      .then(result => {
        if (cb) cb(null, result);
      })
      .catch(err => {
        if (cb) cb(err);
      });
  }

  async getFreeSpaceAsync() {
    let command =
      'import os, sys\r\n' +
      "_s = os.statvfs('" + this.mcu_root_folder + "')\r\n" +
      'sys.stdout.write(str(s[0]*s[3])\r\n' +
      'del(_s)\r\n';

    return await this.pyboard.xxSendWait(command);
  }

  decompress(name, execute, cb) {
    this.decompressAsync(name)
      .then(result => {
        if (cb) cb(null, result);
      })
      .catch(err => {
        if (cb) cb(err);
      });
  }

  async decompressAsync(name) {
    let command =
      'import uzlib\r\n' +
      'def decompress(name):\r\n' +
      "  with open(name,'r+') as d:\r\n" +
      '    c = uzlib.decompress(d.read())\r\n' +
      "  with open(name,'w') as d:\r\n" +
      '      d.write(c)\r\n' +
      '  del(c)\r\n' +
      "decompress('" + name + "')\r\n";

    return await this.pyboard.xxSendWait(command, null, 40000);
  }

  compress(filepath, name, cb) {

    let name_only = name.substr(name.lastIndexOf('/') + 1);
    let zipped_path = filepath.replace(name, this.config
      .compressed_files_folder + '/');
    let zipped_filepath = zipped_path + name_only + '.gz';

    this.utils.ensureDirectoryExistence(zipped_path);

    exec('python ' + this.package_folder + '/scripts/compress.py "' +
      filepath + '" "' + zipped_filepath + '"',
      function(error, stdout, stderr) {
        cb(error, stdout, zipped_filepath);
      }
    );
  }

  writeFile(name, file_path, contents, compare_hash, compress, callback,
    retries = 0) {
    this.writeFileAsync(name, file_path, contents, compare_hash, compress,
        retries)
      .then(() => {
        if (callback) callback();
      })
      .catch(err => {
        if (callback) callback(err);
      });
  }

  async writeFileAsync(name, file_path, contents, compare_hash, compress,
    attempts = 0) {
    let fw = new FileWriter(this, this.pyboard, this.settings, this.api);
    // let hash = '';
    // if (compare_hash)
    //   hash = await this.getHashAsync(file_path);
    await fw.writeFileContent(name, file_path, contents, attempts);
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

    let command = 'import os\r\n' +
      'def ensureFolder(folder):\r\n' +
      '   try:\r\n' +
      '     os.mkdir(folder)\r\n' +
      '   except OSError:\r\n' +
      '     ...\r\n' +
      '\r\n';

    for (let i = 1; i <= parts.length; i++) {
      command += `ensureFolder("${parts.slice(0, i).join('/')}")\r\n`;
    }

    _this.eval(command, function(err, content) {
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

    let command = 'import os\r\n' +
      'def ensureFolder(folder):\r\n' +
      '   try:\r\n' +
      '     os.mkdir(folder)\r\n' +
      '   except OSError:\r\n' +
      '     ...\r\n' +
      '\r\n';

    for (let i = 1; i <= parts.length; i++) {
      command += `ensureFolder("${parts.slice(0, i).join('/')}")\r\n`;
    }

    await this.pyboard.xxSendWait(command, null, 30000);
  }

  readFile(name, callback) {
    this.readFileAsync(name)
      .then(result => {
        if (callback) callback(null, result.buffer, result.str);
      })
      .catch(err => {
        if (callback) callback(err);
      });
  }

  async readFileAsync(name) {
    this.working = true;

    // avoid leaking file handles 
    let command = 'import ubinascii,sys' + '\r\n' +
      "with open('" + name + "', 'rb') as f:" + '\r\n' +
      '  while True:' + '\r\n' +
      '    c = ubinascii.b2a_base64(f.read(' + this.BIN_CHUNK_SIZE + '))' +
      '\r\n' +
      '    sys.stdout.write(c)' + '\r\n' +
      "    if not len(c) or c == b'\\n':" + '\r\n' +
      '        break\r\n';

    let content = await this.pyboard.xxSendWait(command, null, 60000);

    // Workaround for the "OK" return of soft reset, which is sometimes returned with the content
    if (content.indexOf('OK') == 0) {
      content = content.slice(2, content.length);
    }
    // Did an error occur 
    if (content.includes('Traceback (')) {
      // some type of error
      this.logger.silly('Traceback error reading file contents: ' + content);
      // pass the error back
      throw content;
    }

    let decode_result = this.utils.base64decode(content);
    let content_buffer = decode_result[1];
    let content_str = decode_result[0].toString();

    this.working = false;

    return {
      buffer: content_buffer,
      str: content_str
    };
  }

  // list files on MCU 
  list_files(cb) {
    let _this = this;
    let file_list = [''];

    let end = function(err, file_list_2) {
      // return no error, and the retrieved file_list
      cb(undefined, file_list);
    };

    let worker = function(params, callback) {
      if (_this.interrupted) {
        _this.interrupt_cb();
        return;
      }
      _this.workers.list_files(params, callback);
    };
    // need to determine what the root folder of the board is
    _this.utils.doRecursively([_this.mcu_root_folder, [''], file_list],
      worker, end);
  }

  removeFile(name, cb) {
    let _this = this;
    let command =
      'import os\r\n' +
      "os.remove('" + name + "')\r\n";

    _this.eval(command, function(err, content) {
      cb(err, content);
    });
  }

  async removeFileAsync(name) {
    let command =
      'import os\r\n' +
      "os.remove('" + name + "')\r\n";

    await this.pyboard.xxSendWait(command);
  }

  createDir(name, cb) {
    this.createDir(name)
      .then(() => {
        if (cb) cb();
      })
      .catch(err => {
        if (cb) cb(err);
      });
  }

  async createDirAsync(name) {
    let command =
      'import os\r\n' +
      "os.mkdir('" + name + "')\r\n";
    await this.pyboard.xxSendWait(command);
  }

  async changeDirAsync(name) {
    let command =
      'import os\r\n' +
      "os.chdir('" + name + "')\r\n";
    await this.pyboard.xxSendWait(command);
  }

  removeDir(name, cb) {
    this.removeDirAsync(name)
      .then(() => {
        if (cb) cb();
      })
      .catch(err => {
        if (cb) cb(err);
      });
  }

  async removeDirAsync(name) {
    let command =
      'import os\r\n' +
      "os.rmdir('" + name + "')\r\n";
    await this.pyboard.xxSendWait(command);
  }

  reset(cb) {
    this.resetAsync()
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async resetAsync() {
    let command =
      'import machine\r\n' +
      'machine.reset()\r\n';

    await this.pyboard.xxSend(command);
    await this.pyboard.xxSend(this.EOF); // Execute.
  }

  safeboot_restart(cb) {
    this.safebootRestartAsync()
      .then(() => {
        if (cb) cb();
      })
      .catch(err => {
        if (cb) cb(err);
      });
  }

  async safebootRestartAsync() {
    await this.pyboard.safebootAsync(4000);
    await this.pyboard.enterRawReplNoResetAsync();
  }

  // evaluates command through REPL and returns the resulting feedback
  eval(c, cb, timeout) {
    this.evalAsync(c, timeout)
      .then(result => {
        if (cb) cb(null, result);
      })
      .catch(err => {
        if (cb) cb(err);
      });
  }

  async evalAsync(c, timeout) {
    return await this.xxSendWait(c, null, timeout);
  }

  exit(cb) {
    this.exitAsync()
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async exitAsync() {
    await this.stopWorkingAsync();
    await this._cleanCloseAsync();
  }

  stop_working(cb) {
    this.stopWorkingAsync()
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async stopWorkingAsync() {
    // This is the limit that this can be async-awaitified.
    // Does rely on callbacks to work.
    // eslint-disable-next-line no-unused-vars
    return new Promise((resolve, reject) => {
      let _this = this;
      if (this.working) {
        _this.logger.info(
          'Exiting shell while still working, doing interrupt');
        let cb_done = false;
        this.interrupt_cb = function() {
          cb_done = true;
          _this.working = false;
          _this.interrupted = false;
          _this.interrupt_cb = null;
          _this.logger.info('Interrupt done, closing');
          resolve();
        };
        this.interrupted = true;
        setTimeout(function() {
          if (!cb_done) {
            _this.logger.info(
              'Interrupt timed out, continuing anyway');
            resolve();
          }
        }, 1000);
      }
      else {
        _this.logger.info('Not working, continuing closing');
        resolve();
      }
    });
  }

  __clean_close(cb) {
    this._cleanCloseAsync()
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async _cleanCloseAsync() {
    this.logger.info('Closing shell cleanly');

    if (this.settings.reboot_after_upload) {
      this.logger.info('Rebooting after upload');
      // No need to await this.
      this.resetAsync();
      return;
    }

    await this.pyboard.enterFriendlyReplAsync();
    await this.pyboard.xxSend('\r\n');

    this.logger.info('Closed successfully');

    if (this.pyboard.connection.type != 'serial') {
      await this.pyboard.disconnectSilentAsync();
    }
  }
}