'use babel';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as crypto from 'crypto';
import Logger from '../helpers/logger.js';
import Utils from '../helpers/utils.js';

export default class ProjectStatus {

  constructor(shell, settings, local_folder) {
    this.shell = shell;
    this.logger = new Logger('ProjectStatus');
    this.utils = new Utils(settings);
    this.localFolder = local_folder;
    this.settings = settings;
    this.allowedFileTypes = this.settings.getAllowedFileTypes();
    this.content = [];
    this.boardFileHashes = {};
    this.localFileHashes = this.__get_local_files_hashed();
    this.changed = false;
  }

  read(cb) {
    this.readAsync()
      .then(result => {
        if (cb) cb(null, result);
      })
      .catch(err => {
        if (cb) cb(err);
      });
  }

  async readAsync() {
    let result = await this.shell.readFileAsync('project.pymakr');

    let json = [];

    if (result.str != '') {
      json = JSON.parse(result.str);
    }
    this.content = json;
    this.__process_file();

    return json;
  }

  write_all(cb) {
    this.writeAllAsync()
      .then(() => {
        if (cb) cb();
      })
      .catch(err => {
        if (cb) cb(err);
      });
  }

  async writeAllAsync() {
    this.boardFileHashes = this.localFileHashes;
    await this.writeAsync();
  }

  write(cb) {
    this.writeAsync()
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    }); 
  }

  async writeAsync() {
    try {
      if (this.changed) {
        this.logger.info('Writing project status file to board');
        let boardHashArray = Object.values(this.boardFileHashes);
        let projectFileContent = Buffer.from(JSON.stringify(
          boardHashArray));
        await this.shell.writeFileAsync('project.pymakr', null,
          projectFileContent);
      }
      else {
        this.logger.info('No changes to file, not writing');
      }
    }
    catch (err) {
      this.changed = false;
      throw err;
    }
  }

  update(name) {
    this.changed = true;
    if (!this.localFileHashes[name]) {
      delete this.boardFileHashes[name];
    }
    else {
      this.boardFileHashes[name] = this.localFileHashes[name];
    }
  }

  remove(filename) {
    delete this.boardFileHashes[filename];
  }

  __process_file() {
    for (let i = 0; i < this.content.length; i++) {
      let h = this.content[i];
      this.boardFileHashes[h[0]] = h;
    }
  }

  __get_local_files(dir) {
    return fs.readdirSync(dir);
  }

  async _getLocalFilesAsync(dir) {
    return await fsp.readdir(dir);
  }

  __get_local_files_hashed(files, path) {
    if (!files) {
      try {
        files = this.__get_local_files(this.localFolder);
      }
      catch (e) {
        this.logger.error("Couldn't locate file folder");
        return false;
      }
    }
    if (!path) {
      path = '';
    }
    let file_hashes = {};

    files = this.utils.ignoreFilter(files);

    for (let i = 0; i < files.length; i++) {
      let filename = path + files[i];
      if (filename.length > 0 && filename.substring(0, 1) != '.') {
        let file_path = this.localFolder + filename;
        let stats = fs.lstatSync(file_path);
        let is_dir = stats.isDirectory();
        if (stats.isSymbolicLink()) {
          is_dir = filename.indexOf('.') == -1;
        }
        if (is_dir) {
          try {
            let files_from_folder = this.__get_local_files(file_path);
            if (files_from_folder.length > 0) {
              let hash = crypto.createHash('sha256').update(filename).digest(
                'hex');
              file_hashes[filename] = [filename, 'd', hash];
              let hashes_in_folder = this.__get_local_files_hashed(
                files_from_folder, filename + '/');
              file_hashes = Object.assign(file_hashes, hashes_in_folder);
            }
          }
          catch (e) {
            this.logger.info('Unable to read from dir ' + file_path);
            console.log(e);
          }
        }
        else {
          let contents = fs.readFileSync(file_path);
          let hash = crypto.createHash('sha256').update(contents).digest(
            'hex');
          file_hashes[filename] = [filename, 'f', hash, stats.size];
        }
      }
    }
    return file_hashes;
  }

  async _getLocalFilesHashedAsync(files, path) {
    if (!files) {
      try {
        files = await this._getLocalFilesAsync(this.localFolder);
      }
      catch (e) {
        this.logger.error("Couldn't locate file folder");
        return false;
      }
    }
    if (!path) {
      path = '';
    }
    let fileHashes = {};

    files = this.utils.ignoreFilter(files);

    for (let i = 0; i < files.length; i++) {
      let filename = path + files[i];
      if (filename.length > 0 && filename.substring(0, 1) != '.') {
        let filePath = this.localFolder + filename;
        let stats = await fsp.lstat(filePath);
        let isDir = stats.isDirectory();
        if (stats.isSymbolicLink()) {
          isDir = filename.indexOf('.') == -1;
        }
        if (isDir) {
          try {
            let filesFromFolder = await this._getLocalFilesAsync(filePath);
            if (filesFromFolder.length > 0) {
              let hash = crypto.createHash('sha256').update(filename).digest(
                'hex');
              fileHashes[filename] = [filename, 'd', hash];
              let hashes_in_folder = await this._getLocalFilesHashedAsync(
                filesFromFolder, filename + '/');
              fileHashes = Object.assign(fileHashes, hashes_in_folder);
            }
          }
          catch (e) {
            this.logger.info('Unable to read from dir ' + filePath);
            console.log(e);
          }
        }
        else {
          let contents = await fsp.readFile(filePath);
          let hash = crypto.createHash('sha256').update(contents).digest(
            'hex');
          fileHashes[filename] = [filename, 'f', hash, stats.size];
        }
      }
    }
    return fileHashes;
  }

  prepare_file(py_folder, file_path) {
    let contents = fs.readFileSync(file_path);
    let stats = fs.lstatSync(file_path);
    let hash = crypto.createHash('sha256').update(contents).digest('hex');
    let filename = file_path.replace(py_folder, '');
    return [filename, 'f', hash, stats.size];
  }

  async prepareFileAsync(py_folder, file_path) {
    let contents = await fsp.readFile(file_path);
    let stats = await fsp.lstat(file_path);
    let hash = crypto.createHash('sha256').update(contents).digest('hex');
    let filename = file_path.replace(py_folder, '');
    return [filename, 'f', hash, stats.size];
  }

  get_changes() {
    let changedFiles = [];
    let changedFolders = [];
    let deletes = [];
    let boardHashes = Object.assign({}, this.boardFileHashes);
    let localHashes = Object.assign({}, this.localFileHashes);

    // all local files
    for (let name in localHashes) {
      let localHash = this.localFileHashes[name];
      let boardHash = boardHashes[name];

      if (boardHash) {
        // check if hash is the same
        if (localHash[2] != boardHash[2]) {

          if (localHash[1] == 'f') {
            changedFiles.push(localHash);
          }
          else {
            changedFolders.push(localHash);
          }
        }
        delete boardHashes[name];

      }
      else {
        if (localHash[1] == 'f') {
          changedFiles.push(localHash);
        }
        else {
          changedFolders.push(localHash);
        }
      }
    }
    for (let name in boardHashes) {
      if (boardHashes[name][1] == 'f') {
        deletes.unshift(boardHashes[name]);
      }
      else {
        deletes.push(boardHashes[name]);
      }

    }
    return { 'delete': deletes, 'files': changedFiles, 'folders': changedFolders };
  }
}