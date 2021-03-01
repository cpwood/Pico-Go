'use babel';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
//let vscode = require('vscode');
//let ncp = require('copy-paste');
import * as vscode from 'vscode';
import * as ncp from 'copy-paste';
import utils from '../helpers/utils.js';
import { window, workspace } from 'vscode';
import Config from '../config.js';

export default class ApiWrapper {
  constructor(settings) {
    this.defaultConfig = Config.settings();
    this.settings = settings;
    this.first_time_opening = false;
    this.configFile = utils.getConfigPath('pico-go.json');
    this.isWindows = process.platform == 'win32';
    this.projectPath = this.getProjectPath();
    this.connectionStateFilename = 'connection_state.json';
  }

  config(key) {
    if (this.settings.globalConfig[key] !== undefined) {
      return this.settings.globalConfig[key];
    }
    else if (this.defaultConfig[key] !== undefined) {
      return this.defaultConfig[key].default;
    }
    else {
      return null;
    }
  }

  openSettings(cb) {
    this.openSettingsAsync()
      .then(() => {
        if (cb) cb();
      })
      .catch(err => {
        if (cb) cb(err);
      });
  }

  async openSettingsAsync() {
    if (!this.configFile) {
      throw new Error('No config file found');
    }

    if (!this.settingsExist()) {
      // Create settings file
      let defaultConfig = this.settings.getDefaultGlobalConfig();
      let json = JSON.stringify(defaultConfig, null, '\t');

      await fsp.writeFile(this.configFile, json);
      this.settings.watchConfigFile(this.configFile);
    }

    let uri = vscode.Uri.file(this.configFile);
    let textDoc = await vscode.workspace.openTextDocument(uri);
    vscode.window.showTextDocument(textDoc);
  }

  settingsExist() {
    if(this.configFile){
      try{
        fs.openSync(this.configFile,'r');
        return true;
      }catch(e){
        return false;
      }
    }
  }

  async settingsExistAsync() {
    if (this.configFile) {
      return await utils.exists(this.configFile);
    }
    return false;
  }

  writeToCipboard(text) {
    ncp.copy(text, function() {
      // completed
    });
  }

  // It's not happy proimisifying this!
  writeToClipboard(text){
    ncp.copy(text,function(){
      // completed
    });
  }

  getPackagePath() {
    if (this.isWindows) {
      return utils.normalize(__dirname).replace('/lib/main', '/').replace(
        /\//g, '\\');
    }
    else {
      return __dirname.replace('/lib/main', '/');
    }
  }

  getPackageSrcPath() {
    let dir = utils.normalize(__dirname).replace('/lib/main', '/src/');
    if (this.isWindows) {
      dir = dir.replace(/\//g, '\\');
    }
    return dir;
  }

  getConnectionState(com) {
    let state = this.getConnectionStateContents();
    if (!state) return state;
    return state[com];
  }

  getConnectionStatePath() {
    return this.getPackagePath();
  }

  getConnectionStateContents() {
    let folder = this.getConnectionStatePath();
    try {
      return JSON.parse(fs.readFileSync(folder + this
        .connectionStateFilename));
    }
    catch (e) {
      console.log(e);
      // ignore and continue
      return {};
    }
  }

  async getConnectionStateContentsAsync() {
    let folder = this.getConnectionStatePath();
    try {
      return JSON.parse(await fsp.readFile(folder + this
        .connectionStateFilename));
    }
    catch (e) {
      console.log(e);
      return {};
    }
  }

  setConnectionState(com, state, project_name) {
    let folder = this.getConnectionStatePath();
    let timestamp = new Date().getTime();
    let stateObject = this.getConnectionStateContents();

    if (state) {
      stateObject[com] = { timestamp: timestamp, project: project_name };
    }
    else if (stateObject[com]) {
      delete stateObject[com];
    }

    fs.writeFileSync(folder + '/connection_state.json', JSON.stringify(
      stateObject));
  }

  async setConnectionStateAsync(com, state, project_name) {
    let folder = this.getConnectionStatePath();
    let timestamp = new Date().getTime();
    let stateObject = this.getConnectionStateContents();

    if (state) {
      stateObject[com] = { timestamp: timestamp, project: project_name };
    }
    else if (stateObject[com]) {
      delete stateObject[com];
    }

    await fsp.writeFile(folder + '/connection_state.json', JSON.stringify(
      stateObject));
  }

  getProjectPaths() {
    let path = this.rootPath();
    if (path == null) return [];
    return [path];
  }

  error(text) {
    window.showErrorMessage(text);
  }

  confirm(text, options) {
    let items = [];
    for (let key in options) {
      items.push(key);
    }
    let option_item = {
      placeHolder: text
    };

    return window.showQuickPick(items, option_item).then(function(item) {
      if (item) {
        options[item]();
      }
      else {
        options['Cancel']();
      }
    });
  }

  async confirmAsync(text, options) {
    return await window.showQuickPick(options, {
      placeHolder: text
    });
  }

  getProjectPath() {
    return this.rootPath();
  }

  rootPath() {
    // TODO: multi-workspace folders
    // https://github.com/microsoft/vscode/wiki/Adopting-Multi-Root-Workspace-APIs#eliminating-rootpath
    let path = workspace.rootPath;
    if (path && path != '') {
      if (this.isWindows) {
        path = path.replace(/\//g, '\\');
      }
      return path;
    }
    return null;
  }

  openFile(filename, cb) {
    let uri = vscode.Uri.file(filename);
    workspace.openTextDocument(uri).then(function(textDoc) {
      vscode.window.showTextDocument(textDoc);
      cb();
    });
  }

  async openFileAsync(filename) {
    let uri = vscode.Uri.file(filename);
    let textDoc = await workspace.openTextDocument(uri);
    vscode.window.showTextDocument(textDoc);
  }

  notification(text, type) {
    if (type == 'warning') {
      vscode.window.showWarningMessage(text);
    }
    else if (type == 'info') {
      vscode.window.showInformationMessage(text);
    }
    else if (type == 'error') {
      vscode.window.showErrorMessage(text);
    }
  }

  error(text) {
    this.notification(text, 'error');
  }

  info(text) {
    this.notification(text, 'info');
  }

  warning(text) {
    this.notification(text, 'warning');
  }

  getOpenFile() {
    let editor = window.activeTextEditor;
    let doc = editor.document;
    let name = doc.fileName;
    return {
      content: doc.getText(),
      path: name
    };
  }

  getSelected() {
    let editor = window.activeTextEditor;
    let selection = editor.selection;
    let codesnip = '';
    if (!selection.isEmpty) {
      //no active selection , get the current line 
      return editor.document.getText(selection);
    }
    return codesnip;
  }

  getSelectedOrLine() {
    let code = this.getSelected();

    if (!code) {
      let editor = window.activeTextEditor;
      let selection = editor.selection;
      // the Active Selection object gives you the (0 based) line  and character where the cursor is 
      code = editor.document.lineAt(selection.active.line).text;
    }
    return code;
  }

  // restore the focus to the Editor after running a section of code
  editorFocus() {
    vscode.commands.executeCommand('workbench.action.focusPreviousGroup');
  }

}