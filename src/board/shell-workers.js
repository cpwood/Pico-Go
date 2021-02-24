'use babel';
import Logger from '../helpers/logger.js';
import * as binascii from 'binascii';
import ShellWorkerResult from './shell-worker-result.js';

/*
These are used in combination with Utils.doRecursively. 
doRecursively effectively manages a loop while the methods
below do the actual work.

E.g. writeFile would be called multiple times by doRecursively
until the piece of work is complete.
*/
export default class ShellWorkers {

  constructor(shell, pyboard, settings) {
    this.shell = shell;
    this.settings = settings;
    this.BIN_CHUNK_SIZE = this.settings.upload_chunk_size;
    this.pyboard = pyboard;
    this.logger = new Logger('ShellWorkers');
  }

  write_file(value, callback) {
    //   (err, value_processed, done)
    let _this = this;
    let blocksize = _this.BIN_CHUNK_SIZE;
    let content = value[0];
    let counter = value[1];
    let err_mssg = '';

    if (counter * blocksize >= content.length) {
      callback(null, content, true);
    }
    else {
      let start = counter * blocksize;
      let end = Math.min((counter + 1) * blocksize, content.length);
      let chunk = content.base64Slice(start, end);
      // c = binascii.b2a_base64(chunk)

      _this.pyboard.exec_raw("f.write(ubinascii.a2b_base64('" + chunk +
        "'))\r\n",
        function(err, data) {
          if (data.indexOf('Traceback: ') > -1 || data.indexOf('Error: ') >
            -1) {
            err_mssg = data.slice(data.indexOf('Error: ') + 7, -3);
            err = new Error('Failed to write file: ' + err_mssg);
          }
          if (err) {
            _this.logger.error('Failed to write chunk:');
            _this.logger.error(err);
            callback(err, null);
            return;
          }
          callback(null, [content, counter + 1]);
        });
    }
  }

  async writeFileAsync(value) {
    let content = value[0];
    let counter = value[1];
    let errorMessage = '';
    let err = null;

    if (counter * this.BIN_CHUNK_SIZE >= content.length) {
      return new ShellWorkerResult(content, true);
    }

    let start = counter * this.BIN_CHUNK_SIZE;
    let end = Math.min((counter + 1) * this.BIN_CHUNK_SIZE, content.length);
    let chunk = content.base64Slice(start, end);

    let data = await this.pyboard.execRawAsync(
      `f.write(ubinascii.a2b_base64('${chunk}'))\r\n`);

    if (data.indexOf('Traceback: ') > -1 || data.indexOf('Error: ') > -1) {
      errorMessage = data.slice(data.indexOf('Error: ') + 7, -3);
      err = new Error(`Failed to write file: ${errorMessage}`);
      throw err;
    }

    return new ShellWorkerResult([content, counter + 1], false);
  }

  list_files(params, callback) {
    let _this = this;
    let [root, names, file_list] = params;

    if (names.length == 0) {
      callback(null, file_list, true);
    }
    else {
      let current_file = names[0];
      let current_file_root;
      if (root.slice(-1) == '/') {
        current_file_root = root + current_file;
      }
      else {
        current_file_root = root + '/' + current_file;
      }
      names = names.splice(1);
      let is_dir = current_file.indexOf('.') == -
        1; //fixme: document: this does not allow folder names containing a .
      if (is_dir) {
        let c = 'import ubinascii, sys, os\r\n';
        c += "list = ubinascii.hexlify(str(os.listdir('" + current_file_root +
          "')))\r\n";
        c += 'sys.stdout.write(list)\r\n';
        _this.logger.info('os.listdir: ' + current_file_root);
        _this.shell.eval(c, function(err, content) {
          if (content) {
            let data = binascii.unhexlify(content);
            //data = data.slice(1, -2);
            try {
              let list = eval(data);
              // Filter bad results
              list = list.filter(function(item) {
                if (!item.includes('\x00')) {
                  return item;
                }
              });
              for (let i = 0; i < list.length; i++) {
                let item = list[i];
                names.push(_this.get_file_with_path(current_file_root,
                  item));
              }
              callback(null, [root, names, file_list]);
            }
            catch (e) {
              _this.logger.error('Evaluation of content went wrong');
              _this.logger.error(data); // log the data recieved 
              _this.logger.error(e);
              callback(e, [root, names, file_list]);
            }
          }
          else {
            callback(new Error('Failed to write file'), [root, names,
              file_list
            ]);
          }
        });
      }
      else {
        let file_path = current_file_root;
        file_path = file_path.slice(this.shell.mcu_root_folder.length);
        if (file_path.startsWith('/')) {
          file_path = file_path.substring(1);
        }

        file_list.push(file_path);
        callback(null, [root, names, file_list]);
      }
    }
  }

  async listFilesAsync(params) {
    let [root, names, file_list] = params;

    if (names.length == 0) {
      return new ShellWorkerResult(file_list, true);
    }

    let current_file = names[0];
    let current_file_root;
    if (root.slice(-1) == '/') {
      current_file_root = root + current_file;
    }
    else {
      current_file_root = root + '/' + current_file;
    }
    names = names.splice(1);
    let is_dir = current_file.indexOf('.') == -1;
    // TODO: document: this does not allow folder names containing a .
    if (is_dir) {
      let c = 'import ubinascii, sys, os\r\n';
      c += "list = ubinascii.hexlify(str(os.listdir('" + current_file_root +
        "')))\r\n";
      c += 'sys.stdout.write(list)\r\n';
      this.logger.info('os.listdir: ' + current_file_root);
      let content = await this.shell.evalAsync(c);

      if (content) {
        let data = binascii.unhexlify(content);
        data = data.slice(1, -2);

        let list = eval(data);
        // Filter bad results
        list = list.filter(item => {
          if (!item.includes('\x00')) {
            return item;
          }
        });

        for (let i = 0; i < list.length; i++) {
          let item = list[i];
          names.push(this.get_file_with_path(current_file_root, item));
        }
      }
    }
    else {
      let file_path = current_file_root;
      file_path = file_path.slice(this.shell.mcu_root_folder.length);
      if (file_path.startsWith('/')) {
        file_path = file_path.substring(1);
      }

      file_list.push(file_path);
    }

    return new ShellWorkerResult([root, names, file_list], false);
  }

  get_file_with_path(root, file) {
    let root_cleaned = root.replace(this.shell.mcu_root_folder + '/', '');
    root_cleaned = root_cleaned.replace(this.shell.mcu_root_folder.replace(
      /^\//, '') + '/', '');

    if (root_cleaned != '') {
      root_cleaned += '/';
    }
    let file_path = root_cleaned + file;
    if (file_path[0] == '/') {
      file_path = file_path.substring(1);
    }
    return file_path;
  }
}