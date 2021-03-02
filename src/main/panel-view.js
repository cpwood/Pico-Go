'use babel';

import * as vscode from 'vscode';
import { StatusBarAlignment, window } from 'vscode';
import Term from './terminal';
import ApiWrapper from '../main/api-wrapper.js';
import Logger from '../helpers/logger.js';
import EventEmitter from 'events';

const pkg = vscode.extensions.getExtension('chriswood.pico-go').packageJSON;

export default class PanelView extends EventEmitter {
  constructor(pyboard, settings) {
    super();
    let _this = this;
    this.settings = settings;
    this.board = pyboard;
    this.visible = true;
    this.api = new ApiWrapper();
    this.logger = new Logger('PanelView');

    this.statusItems = {};

    for (let barItem of pkg.statusBar) {
      this.statusItems[barItem.key] = this.createStatusItem(
        barItem.key,
        barItem.name,
        barItem.command,
        barItem.tooltip
      );
    }

    this.setTitle('not connected');
    // terminal logic
    let onTermConnect = function(err) {
      _this.emit('term-connected', err);
    };

    _this.setProjectName(_this.api.getProjectPath());

    // create terminal
    this.terminal = new Term(onTermConnect, this.board, _this.settings);
    this.terminal.setOnMessageListener(function(input) {
      _this.emit('user_input', input);
    });
  }

  showQuickPick() {
    let items = [];

    let quickPickItems = pkg.contributes.commands;

    for (let qpItem of quickPickItems) {
      if (qpItem.command != 'pymakr.listCommands') {
        items.push({
          label: qpItem.title,
          description: '',
          cmd: qpItem.command
        });
      }
    }

    let options = {
      placeHolder: 'Select Action'
    };

    window.showQuickPick(items, options).then(function(selection) {
      if (typeof selection === 'undefined') {
        return;
      }

      vscode.commands.executeCommand(selection.cmd);
    });
  }

  createStatusItem(key, name, command, tooltip) {
    if (!this.statusItemPrio) {
      this.statusItemPrio = 15;
    }
    let statusBarItem = vscode.window.createStatusBarItem(
      StatusBarAlignment.Left,
      this.statusItemPrio
    );
    statusBarItem.command = command;
    statusBarItem.text = name;
    statusBarItem.tooltip = tooltip;
    if (
      (this.settings.statusbar_buttons &&
        this.settings.statusbar_buttons.indexOf(key) > -1) ||
      key == 'listcommands'
    ) {
      statusBarItem.show();
    }
    this.statusItemPrio -= 1;
    return statusBarItem;
  }

  setProjectName(project_path) {
    if (project_path && project_path.indexOf('/') > -1) {
      this.projectName = project_path.split('/').pop();
    }
    else {
      this.projectName = 'No project';
    }
    this.setButtonState();
  }

  // refresh button display based on current status
  setButtonState(runnerBusy, synchronizing, synchronizeType) {
    // if (!this.visible) {
    //   this.setTitle('not connected')
    // }else if(this.pyboard.connected) {
    if (this.board.connected) {
      if (runnerBusy == undefined) {
        // do nothing
      }
      else if (runnerBusy) {
        this.setButton('run', 'primitive-square', 'Stop');
      }
      else {
        this.setButton('run', 'triangle-right', 'Run');
      }
      if (synchronizing) {
        if (synchronizeType == 'receive') {
          this.setButton('download', 'close', 'Cancel');
        }
        else {
          this.setButton('upload', 'close', 'Cancel');
        }
      }
      else {
        this.setButton('upload', 'triangle-up', 'Upload');
        this.setButton('download', 'triangle-down', 'Download');
      }

      this.setTitle('connected');
    }
    else {
      this.setTitle('not connected');
    }
  }

  setButton(name, icon, text) {
    this.statusItems[name].text = '$(' + icon + ') ' + text;
  }

  setTitle(status) {
    let icon = 'chrome-close';
    let title = 'Pico Disconnected';

    if (status == 'connected') {
      icon = 'check';
      title = 'Pico Connected';
    }

    this.setButton('status', icon, title);
  }

  hidePanel() {
    this.terminal.hide();
    this.visible = false;
  }

  showPanel() {
    this.terminal.clear();
    this.terminal.show();
    this.visible = true;
    this.setButtonState();
  }

  clearTerminal() {
    this.terminal.clear();
  }

  // Tear down any state and detach
  destroy() {
    this.disconnect();
  }

  getElement() {
    return {};
  }
}