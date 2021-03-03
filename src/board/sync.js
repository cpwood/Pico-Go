'use babel';

import Shell from './shell.js';
import Config from '../config.js';
import Logger from '../helpers/logger.js';
import ApiWrapper from '../main/api-wrapper.js';
import ProjectStatus from './project-status.js';
import Utils from '../helpers/utils.js';
import FileWriter from './file-writer.js';
import { promises as fsp } from 'fs';
import _ from 'lodash';

export default class Sync {

  constructor(board, settings, terminal) {
    this.logger = new Logger('Sync');
    this.api = new ApiWrapper();
    this.settings = settings;
    this.board = board;
    this.terminal = terminal;
    this.shell = null;
    this.inRawMode = false;
    this.totalFileSize = 0;
    this.totalNumberOfFiles = 0;
    this.numberOfChangedFiles = 0;
    this.methodAction = 'Downloading';
    this.methodName = 'Download';

    this.utils = new Utils(settings);
    this.config = Config.constants();
    this.projectPath = this.api.getProjectPath();
    this.isRunning = false;
    this.isStopping = false;
    this.fails = 0;
    this.compressionLimit =
      5; // minimum file size in kb that will be compressed
    this.setPaths();
    this.projectStatus = new ProjectStatus(this.shell, this.settings, this
      .pyFolder);
  }

  async _isReady() {

    // check if there is a project open
    if (!this.projectPath) {
      return new Error('No project open');
    }
    // check if project exists
    if (!await this._existsAsync(this.pyFolder)) {
      console.log("Py folder doesn't exist");
      return new Error("Unable to find folder '" + this.settings.sync_folder +
        "' in your project. Please add the correct folder in your settings");
    }

    return true;
  }

  async _existsAsync(dir) {
    return await Utils.exists(dir);
  }

  _progress(text, count) {
    if (count) {
      this.progressFileCount += 1;
      text = '[' + this.progressFileCount + '/' + this
        .numberOfChangedFiles + '] ' + text;
    }
    let _this = this;
    setTimeout(function() {
      _this.terminal.writeln(text);
    }, 0);
  }

  _syncDone(err) {
    this.logger.verbose('Sync done!');
    this.isRunning = false;
    let mssg = this.methodName + ' done';
    if (err) {
      mssg = this.methodName + ' failed.';
      mssg += err.message && err.message != '' ? ': ' + err.message : '';
      if (this.inRawMode) {
        mssg += ' Please reboot your device manually.';
      }
    }
    else if (this.inRawMode && this.settings.reboot_after_upload) {
      mssg += ', resetting board...';
    }

    this.terminal.writeln(mssg);

    if (this.board.connected && !this.inRawMode) {
      this.terminal.writePrompt();
    }

    if (this.oncomplete) {
      this.oncomplete();
      this.oncomplete = null;
    }
    else {
      this.logger.warning('Oncomplete not set!');
    }
  }

  _resetValues(oncomplete, method) {
    // prepare variables
    if (method != 'receive') {
      method = 'send';
      this.methodAction = 'Uploading';
      this.methodName = 'Upload';
    }
    this.method = method;
    this.oncomplete = oncomplete;
    this.totalFileSize = 0;
    this.totalNumberOfFiles = 0;
    this.numberOfChangedFiles = 0;
    this.progressFileCount = 0;
    this.isRunning = true;
    this.inRawMode = false;
    this.setPaths();
  }

  setPaths() {
    this.projectPath = this.api.getProjectPath();
    if (this.projectPath) {

      this.projectName = this.projectPath.split('/').pop();

      let dir = this.settings.sync_folder.replace(/^\/|\/$/g,
        ''); // remove first and last slash
      this.pyFolder = this.projectPath + '/';
      if (dir) {
        this.pyFolder += dir + '/';
      }

      let syncFolder = this.settings.sync_folder;
      let folderName = syncFolder == '' ? 'main folder' : syncFolder;
      this.folderName = folderName;
    }
  }

  async startSendAsync(oncomplete, files) {
    await this.settings.refreshAsync();
    await this._startSyncAsync(oncomplete, 'send', files);
  }

  async startReceiveAsync(oncomplete, files) {
    await this.settings.refreshAsync();
    await this._startSyncAsync(oncomplete, 'receive', files);
  }

  async _startSyncAsync(oncomplete, method, files) {
    this.logger.info('Start sync method ' + method);
    this.fails = 0;
    this.method = method;

    try {
      this._resetValues(oncomplete, method);
    }
    catch (e) {
      this.logger.error(e);
      this._syncDone(e);
      return;
    }

    // check if project is ready to sync
    let ready = await this._isReady();
    if (ready instanceof Error) {
      this._syncDone(ready);
      return;
    }

    // make sure next messages will be written on a new line
    this.terminal.enter();

    if (files) {
      let filename = files.split('/').pop();
      this.terminal.write(
        `${this.methodAction} current file (${filename})...\r\n`);
    }
    else {
      this.terminal.write(
        `${this.methodAction} project (${this.folderName})...\r\n`);
    }

    try {
      await this._safeBootAsync();
      this.logger.info('Safeboot succesful');
    }
    catch (err) {
      this.logger.error('Safeboot failed');
      this.logger.error(err);
      this._progress(
        `Safe boot failed, '${this.methodAction.toLowerCase()} anyway.`);
    }

    this.logger.silly('Start shell');

    try {
      await this._startShellAsync();

      this.inRawMode = true;

      let direction = 'to';
      if (this.methodAction.toLowerCase() == 'downloading') {
        direction = 'from';
      }
      this.terminal.write(
        `${this.methodAction} ${direction} ${this.shell.mcuRootFolder} ...\r\n`
      );

      this.projectStatus = new ProjectStatus(this.shell, this.settings, this
        .pyFolder);
      this.logger.silly('Entered raw mode');

      if (!this.isRunning) {
        this._stoppedByUser();
        return;
      }
    }
    catch (err) {
      this.logger.error(err);
      await this._throwErrorAsync(err);
      this.exit();
      return;
    }

    if (this.method == 'receive') {
      await this._receiveAsync();
    }
    else {
      await this._sendAsync(files);
    }

    this._syncDone();
  }

  async _receiveAsync() {
    this._progress('Reading files from board');

    let fileList = null;

    try {
      fileList = await this.shell.listAsync('.', true, false);
      fileList = _.filter(fileList, x => x.Type == 'file');
      fileList = _.map(fileList, x => x.Fullname.substr(1));
    }
    catch (err) {
      this._progress(
        'Failed to read files from board, canceling file download');
      await this._throwErrorAsync(err);
      return;
    }

    this.files = await this._getFilesRecursiveAsync(''); // files on PC

    let newFiles = [];
    let existingFiles = [];

    fileList = this.utils.ignoreFilter(fileList);

    for (let i = 0; i < fileList.length; i++) {
      let file = fileList[i];
      if (this.files.indexOf(file) > -1) {
        existingFiles.push(file);
      }
      else {
        newFiles.push(file);
      }
    }
    fileList = existingFiles.concat(newFiles);

    let mssg = 'No files found on the board to download';

    if (newFiles.length > 0) {
      mssg =
        `Found ${newFiles.length} new ${this.utils.plural('file',fileList.length)}`;
    }

    if (existingFiles.length > 0) {
      if (newFiles.length == 0) {
        mssg = 'Found ';
      }
      else {
        mssg += ' and ';
      }
      mssg +=
        `${existingFiles.length} existing ${this.utils.plural('file',fileList.length)}`;
    }

    this.choiceTimeout = Date.now();

    let options = [
      'Cancel',
      'Yes'
    ];

    if (newFiles.length > 0) {
      options.push('Only new files');
    }

    await Utils.sleep(100);

    if (fileList.length == 0) {
      await this._completeAsync();
      return true;
    }

    mssg =
      `${mssg}. Do you want to download these files into your project (${this.projectName} - ${this.folderName}), overwriting existing files?`;
    this._progress(mssg);
    this._progress('(Use the confirmation box at the top of the screen)');

    let chosen = await this.api.confirmAsync(mssg, options);

    switch (chosen) {
      case 'Cancel':
        await this._receiveCancelAsync();
        break;
      case 'Yes':
        await this._receiveOverwriteAsync(fileList);
        break;
      case 'Only new files':
        await this._receiveOnlyNewAsync(newFiles);
        break;
    }
  }

  _checkChoiceTimeout() {
    if (Date.now() - this.choiceTimeout > 29000) {
      this._throwErrorAsync(new Error(
        'Choice timeout (30 seconds) occurred.'));
      return false;
    }
    return true;
  }

  async _receiveCancelAsync() {
    if (this._checkChoiceTimeout()) {
      this._progress('Cancelled');
      await this._completeAsync();
    }
  }

  async _receiveOverwriteAsync(fileList) {
    if (this._checkChoiceTimeout()) {
      this._progress(
        `Downloading ${fileList.length} ${this.utils.plural('file',fileList.length)}...`
      );
      this.progressFileCount = 0;
      this.numberOfChangedFiles = fileList.length;

      await this._receiveFilesAsync(fileList);

      this.logger.info('All items received');
      this._progress('All items overwritten');
      await this._completeAsync();
    }
  }

  async _receiveOnlyNewAsync(newFiles) {
    if (this._checkChoiceTimeout()) {
      this._progress('Downloading ' + newFiles.length + ' files...');
      this.progressFileCount = 0;
      this.numberOfChangedFiles = newFiles.length;

      await this._receiveFilesAsync(newFiles);

      this.logger.info('All items received');
      this._progress('All items overwritten');
      await this._completeAsync();
    }
  }

  async _safeBootAsync() {
    await this.board.stopRunningProgramsDoubleAsync(500);

    if (!this.settings.safe_boot_on_upload) {
      this._progress('Not safe booting, disabled in settings');
      return false;
    }

    if (!this.board.isSerial) {
      return false;
    }

    this.logger.info('Safe booting...');
    this._progress('Safe booting device... (see settings for more info)');
    await this.board.safeBootAsync(4000);
  }

  async _receiveFilesAsync(list) {
    for (let boardName of list) {
      this._progress(`Reading ${boardName}`, true);

      let localName = this.pyFolder + boardName;
      let buffer = null;

      try {
        let result = await this.shell.readFileAsync(boardName);
        buffer = result.buffer;
      }
      catch (err) {
        this._progress(`Failed to download ${boardName}`);
        this.logger.error(err);
        continue;
      }

      try {
        await this.utils.ensureFileDirectoryExistenceAsync(localName);
        await fsp.writeFile(localName, buffer);
      }
      catch (e) {
        this.logger.error(`Failed to open and write ${localName}`);
        this.logger.error(e);
        this._progress(`Failed to write to local file ${boardName}`);
      }
    }
  }

  async _sendAsync(files) {
    this._progress('Reading file status');
    this.logger.info('Reading pymakr file');

    if (!this.isRunning) {
      this._stoppedByUser();
      return;
    }

    // if files given, only upload those files
    if (files) {

      if (!Array.isArray(files)) {
        files = await this.projectStatus.prepareFileAsync(this.pyFolder,
          files);
        files = [files];

        this._progress('Uploading single file');
      }
      else {
        this._progress(`Uploading ${files.length} files`);
      }

      this.numberOfChangedFiles = files.length;
      await this._writeFilesAsync(files);
    }
    else {
      // TODO: this call seems to be there just to drive a log message.. better place for it?
      // otherwise, write changes based on project status file
      try {
        await this.projectStatus.readAsync();
      }
      catch (err) {
        this._progress(
          'Failed to read project status, uploading all files');
      }

      await this._writeChangesAsync();
    }

  }

  async _writeChangesAsync() {
    let changes = this.projectStatus.getChanges();

    let deletes = changes['delete'];
    let changedFiles = changes['files'];
    let changedFolders = changes['folders'];
    let changedFilesFolders = changedFolders.concat(changedFiles);

    this.numberOfChangedFiles = changedFiles.length;
    this.maxFailures = Math.min(Math.ceil(changedFiles.length / 2), 5);

    if (deletes.length > 0) {
      this._progress(`Deleting ${deletes.length} files and folders`);
    }

    if (deletes.length == 0 && changedFiles.length == 0 && changedFolders
      .length == 0) {
      this._progress('No files to upload');
      await this._completeAsync();
      return;
    }

    this.logger.info('Removing files');

    await this._removeFilesRecursiveAsync(deletes);

    if (!this.isRunning) {
      this._stoppedByUser();
      return;
    }
    if (deletes.length > 0) {
      this.logger.info('Updating project-status file');
    }

    await this.projectStatus.writeAsync();

    await this._writeFilesAsync(changedFilesFolders);
  }

  async _writeFilesAsync(files_and_folders) {
    this.logger.info('Writing changed folders');

    try {
      await this._writeFilesRecursiveAsync(files_and_folders);

      if (!this.isRunning) {
        this._stoppedByUser();
        return;
      }
    }
    catch (err) {
      await this._throwErrorAsync(err);
      return;
    }

    this.logger.info('Writing project file');

    try {
      await this.projectStatus.writeAsync();

      if (!this.isRunning) {
        this._stoppedByUser();
        return;
      }

      this.logger.info('Exiting...');
      await this._completeAsync();
    }
    catch (err) {
      await this._throwErrorAsync(err);
      return;
    }
  }

  stopSilent() {
    this.logger.info('Stopping sync');
    this.isRunning = false;
  }

  async stopAsync() {
    this.stopSilent();

    if (!this.shell) {
      this.isRunning = false;
      return;
    }

    await this.shell.stopWorkingAsync();

    this.isRunning = false;

    await this.projectStatus.writeAsync();

    await this._completeAsync();
    this.board.stopWaitingForSilent();
  }

  _stoppedByUser() {
    this.logger.warning('Sync cancelled');
    if (!this.isStopping) {
      this.isStopping = true;
    }
  }

  async _throwErrorAsync(err) {
    let mssg = err ? err : new Error('');

    this.logger.warning('Error thrown during sync procedure');

    await this.syncDoneAsync(mssg);

    let promise = this.board.stopWaitingForSilent();

    if (promise != undefined)
      await promise;

    await this._exitAsync();
    await this.board.enterFriendlyReplNonBlockingAsync();
  }

  async _completeAsync() {
    try {
      await this.utils.rmdirAsync(this.projectPath + '/' + this.config
        .compressed_files_folder);
    }
    catch (e) {
      this.logger.info(
        "Removing py_compressed folder failed, likely it didn't exist");
      this.logger.info(e);
    }

    await this._exitAsync();

    if (this.oncomplete) {
      this.oncomplete();
      this.logger.warning('Oncomplete executed, setting to null');
      this.oncomplete = null;
    }
  }

  async _removeFilesRecursiveAsync(files, depth) {
    if (!depth)
      depth = 0;

    if (files.length == 0) {
      return;
    }
    else {
      let file = files[0];
      let filename = file[0];
      let type = file[1];
      if (type == 'd') {
        this._progress('Removing dir ' + filename);

        try {
          await this.shell.removeDirAsync(filename);
        }
        catch (err) {
          this._progress('Failed to remove dir ' + filename);
        }

        this.projectStatus.update(filename);

        if (!this.isRunning) {
          this._stoppedByUser();
          return;
        }

        files.splice(0, 1);
        await this._removeFilesRecursiveAsync(files, depth + 1);
      }
      else {
        this._progress('Removing file ' + filename);

        try {
          await this.shell.removeFileAsync(filename);
        }
        catch (err) {
          this._progress('Failed to remove file ' + filename);
        }

        this.projectStatus.update(filename);

        if (!this.isRunning) {
          this._stoppedByUser();
          return;
        }

        files.splice(0, 1);
        await this._removeFilesRecursiveAsync(files, depth + 1);
      }
    }
  }

  async _writeFilesRecursiveAsync(files, depth) {
    if (!depth)
      depth = 0;

    if (depth > 0 && depth % 8 == 0) {
      this.logger.info('Updating project-status file');
      await this.projectStatus.writeAsync();
    }

    if (files.length == 0) {
      return;
    }
    else {
      let file = files[0];
      let filename = file[0];
      let type = file[1];
      let size = file[3] ? Math.round(file[3] / 1024) : 0;
      let file_path = this.pyFolder + filename;

      if (type == 'f') {
        let fw = new FileWriter(this.shell, this.board, this.settings, this
          .api);
        let startTime = new Date().getTime();
        let message =
          `Writing file '${filename}' (${size == 0 ? file[3] : size} ${size == 0 ? 'bytes' : 'kB'})`;
        this._progress(message, true);

        try {
          await fw.writeFile(file_path);

          let endTime = new Date().getTime();
          let duration = (endTime - startTime) / 1000;
          this.logger.info('Completed in ' + duration + ' seconds');

          this.projectStatus.update(filename);

          if (!this.isRunning) {
            this._stoppedByUser();
            return;
          }

          files.splice(0, 1);
          await this._writeFilesRecursiveAsync(files, depth + 1);
        }
        catch (err) {
          this._progress(err.message);
          this.logger.error(err);
          throw err;
        }
      }
      else {
        this._progress('Creating dir ' + filename);
        await this.shell.createDirAsync(filename);

        this.projectStatus.update(filename);
        files.splice(0, 1);
        await this._writeFilesRecursiveAsync(files, depth + 1);
      }
    }
  }

  async _startShellAsync() {
    this.shell = new Shell(this.board, this.method, this.settings);
    await this.shell.initialiseAsync();
  }

  async _getFilesAsync(dir) {
    return await fsp.readdir(dir);
  }

  async _getFilesRecursiveAsync(dir) {
    let files = await fsp.readdir(this.pyFolder + dir);
    let list = [];
    for (let i = 0; i < files.length; i++) {
      let filename = dir + files[i];
      let filePath = this.pyFolder + filename;
      let stats = await fsp.lstat(filePath);
      if (!stats.isDirectory()) {
        list.push(filename);
      }
      else {
        list = list.concat(await this._getFilesRecursiveAsync(filename +
        '/'));
      }
    }
    return list;
  }

  async _exitAsync() {
    await this.shell.exitAsync();
  }
}