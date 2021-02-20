'use babel';

import Sync from './board/sync';
import Runner from './board/runner';
import PySerial from './connections/pyserial';
import Utils from './helpers/utils';
import ApiWrapper from './main/api-wrapper.js';
import Logger from './helpers/logger.js';
import Config from './config.js';
import StubsManager from './stubs/stubs-manager';

let EventEmitter = require('events');
let vscode = require('vscode');
let os = require('os');

export default class Pymakr extends EventEmitter {

  constructor(serializedState, pyboard, view, settings) {
    super();
    let _this = this;
    this.pyboard = pyboard;
    this.synchronizing = false;
    this.synchronize_type = '';
    this.settings = settings;
    this.api = new ApiWrapper(settings);
    this.logger = new Logger('Pymakr');
    this.config = Config.constants();
    this.view = view;
    this.autoconnect_timer = null;
    this.autoconnect_address = undefined;
    this.connection_timer = null;
    this.utils = new Utils(settings);



    this.terminal = this.view.terminal;
    this.runner = new Runner(pyboard, this.terminal, this);

    this.settings.on('format_error', function() {
      _this.terminal.writeln('JSON format error in pymakr.conf file');
      if (_this.pyboard.connected) {
        _this.terminal.writePrompt();
      }
    });

    this.settings.on('format_error.project', function() {
      _this.terminal.writeln(
        'JSON format error in pymakr.conf project file');
      if (_this.pyboard.connected) {
        _this.terminal.writePrompt();
      }
    });

    this.view.on('term-connected', function(err) {
      _this.settings.setFileChangedGlobal();
      if (err) {
        _this.logger.error('Error from terminal connect:');
        _this.logger.error(err);
        _this.api.error('Unable to start the terminal');
      }
      _this.logger.info('Connected trigger from view');

      this.first_time_start = !this.api.settingsExist();
      if (this.first_time_start) {
        this.first_time_start = false;
        _this.api.openSettings();
        _this.writeGetStartedText();
      }

      // hide panel if it was hidden after last shutdown of atom
      let close_terminal = serializedState && 'visible' in
        serializedState && !serializedState.visible;

      if (!_this.settings.open_on_start || close_terminal) {
        _this.hidePanel();
      }
      else {
        _this.startAutoConnect(null, true);
      }
    });

    this.view.on('terminal_click', function() {
      _this.logger.verbose('Terminal click emitted');
      if (!_this.pyboard.connected && !_this.pyboard.connecting) {
        _this.logger.verbose('Connecting because of terminal click');
        _this.connect();
      }
    });

    this.view.on('user_input', function(input) {
      // this.terminal.write('\r\n')

      _this.pyboard.sendUserInputAsync(input)
        .catch(err => {
          if (err && err.message == 'timeout') {
            _this.logger.warning('User input timeout, disconnecting');
            _this.logger.warning(err);
            _this.disconnect();
          }
        });

        /*
      _this.pyboard.send_user_input(input, function(err) {
        if (err && err.message == 'timeout') {
          _this.logger.warning('User input timeout, disconnecting');
          _this.logger.warning(err);
          _this.disconnect();
        }
      });
      */
    });

    this.on('auto_connect', function(address) {
      if (!_this.pyboard.connecting) {
        _this.logger.verbose(
          'Autoconnect event, disconnecting and connecting again');
        _this.connect(address);
      }
    });

    this.pyboard.registerStatusListener(function(status) {
      if (status == 3) {
        _this.terminal.enter();
      }
    });

    this.settings.onChange('auto_connect', function(old_value, new_value) {
      _this.logger.info('auto_connect setting changed to ' + new_value);
      _this.stopAutoConnect();
      _this.startAutoConnect();
    });
  }

  startAutoConnect(cb, wait) {
    if (this.view.visible) {
      let _this = this;
      this.logger.info('Starting autoconnect interval...');
      this.stopAutoConnect();
      //this.terminal.writeln("AutoConnect enabled, ignoring 'address' setting (see Global Settings)")
      this.terminal.writeln('Searching for boards on serial devices...');
      if (!wait) {
        this.setAutoconnectAddress(cb);
      }
      this.autoconnect_timer = setInterval(function() {
        _this.setAutoconnectAddress();
      }, 2500);
    }
    else {
      cb(null);
    }
  }

  stopAutoConnect() {
    let previous = this.pyboard.address;
    if (this.autoconnect_timer) {
      this.logger.info('Stop autoconnect');
      clearInterval(this.autoconnect_timer);
      previous = this.autoconnect_address;
      this.autoconnect_address = undefined;
    }
    if (previous != this.settings.address && (this.pyboard.connected || this
        .pyboard.connecting)) {
      this.logger.info('Disconnecting from previous autoconnect address');
      this.disconnect();
    }
  }

  setAutoconnectAddress(cb) {
    let _this = this;
    let emitted_addr = null;
    let failed = false;
    this.getAutoconnectAddress(function(address) {
      _this.logger.silly('Found address: ' + address);
      if (_this.autoconnect_address === undefined && !
        address) { // undefined means first time use
        _this.terminal.writeln('No boards found on USB');
        failed = true;
        // emitted_addr = _this.settings.address
      }
      else if (address && address != _this.autoconnect_address) {
        _this.logger.silly('Found a board on USB: ' + address);
        emitted_addr = address;
        _this.emit('auto_connect', address);
      }
      else if (_this.autoconnect_address && !address) {
        _this.autoconnect_address = null;
        _this.disconnect();
        _this.terminal.writeln(
          '\r\nPrevious board is not available anymore');
        _this.logger.silly('Previous board is not available anymore');
        failed = true;
      }
      else if (!address) {
        _this.logger.silly('No address found');
      }
      else {
        _this.logger.silly('Ignoring address ' + address + ' for now');
      }

      // if(failed){
      //   _this.terminal.writeln("Trying configured address "+_this.settings.address)
      //   _this.emit('auto_connect',_this.settings.address)
      //   emitted_addr = _this.settings.address
      // }
      if (cb) {
        cb(emitted_addr);
      }
      _this.autoconnect_address = address;
    });
  }

  getAutoconnectAddress(cb) {
    let _this = this;

    if (!this.settings.auto_connect && (this.settings.manual_com_device &&
        this.settings.manual_com_device.length > 0)) {
      _this.logger.silly('Manual COM port or device configured.');
      cb(this.settings.manual_com_device);
    }
    else if (this.settings.auto_connect) {
      _this.logger.silly('Autoconnect enabled');
      this.getPycomBoard(function(name, manu, list) {
        let current_address = _this.pyboard.address;
        if (name) {
          // var text = name + " (" + manu+ ")"
          if (!_this.pyboard.connected) {
            cb(name);
          }
          else {
            if (name != _this.pyboard.address) {
              if (list.indexOf(current_address) > -1 || !_this.pyboard
                .isSerial) {
                cb(name);
              }
              else {
                _this.logger.silly(
                  'already connected to a different board, or connected over telnet'
                  );
                cb(null);
              }
            }
            else {
              _this.logger.silly(
              'already connected to the correct board');
              cb(name);
            }
          }
        }
        else {
          cb(null);
          _this.logger.silly('No boards found');
        }
      });
    }
    else {
      cb(null);
    }
  }

  getPycomBoard(cb) {
    let _this = this;
    PySerial.listTargetBoards(this.settings, function(list, manufacturers) {
      if (list.length > 0) {
        let name = list[0];
        let manu = manufacturers[0];
        cb(name, manu, list);
      }
      else {
        cb(null, null, list);
      }
    });
  }

  openProjectSettings() {
    let _this = this;
    this.settings.openProjectSettings(function(err) {
      if (err) {
        console.log(err);
        _this.terminal.writeln(err.message);
        if (_this.pyboard.connected) {
          _this.terminal.writePrompt();
        }
      }
    });
  }

  openGlobalSettings() {
    this.api.openSettings(function() {
      // nothing
    });
  }

  getWifiMac() {
    let _this = this;
    if (!this.pyboard.connected) {
      this.terminal.writeln('Please connect to your device');
      return;
    }

    let command =
      "from network import WLAN; from binascii import hexlify; from os import uname; wlan = WLAN(); mac = hexlify(wlan.mac().ap_mac).decode('ascii'); device = uname().sysname;print('WiFi AP SSID: %(device)s-wlan-%(mac)s' % {'device': device, 'mac': mac[len(mac)-4:len(mac)]})";
    _this.pyboard.send_wait_for_blocking(command + '\n\r', command, function(
      err) {
      if (err) {
        _this.logger.error('Failed to send command: ' + command);
      }
    }, 1000);
  }

  getSerial() {
    let _this = this;
    this.terminal.enter();
    PySerial.listBoards(this.settings, function(list, manufacturers) {
      _this.terminal.writeln('Found ' + list.length + ' serialport' + (
        list.length == 1 ? '' : 's'));
      for (let i = 0; i < list.length; i++) {
        let name = list[i];
        let text = name + ' (' + manufacturers[i] + ')';
        if (i == 0) {
          _this.api.writeToCipboard(name);
          text += ' (copied to clipboard)';
        }

        _this.terminal.writeln(text);
      }
    });
  }

  getVersion() {
    let _this = this;
    if (!this.pyboard.connected) {
      this.terminal.writeln('Please connect to your device');
      return;
    }
    let command = 'import os; os.uname().release\r\n';
    this.pyboard.send_wait_for_blocking(command, command, function(err) {
      if (err) {
        _this.logger.error('Failed to send command: ' + command);
      }
    });
  }

  getFullVersion() {
    let command =
      'import os; ' +
      'print("\\r\\n"); ' +
      `print("Pico-Go:      ${vscode.extensions.getExtension('chriswood.pico-go').packageJSON.version}"); ` +
      `print("VS Code:      ${vscode.version}"); ` +
      `print("Electron:     ${process.versions.electron}"); ` +
      `print("Modules:      ${process.versions.modules}"); ` +
      `print("Node:         ${process.versions.node}"); ` +
      `print("Platform:     ${os.platform()}"); ` +
      `print("Architecture: ${os.arch()}"); ` +
      'print("Board:        " + os.uname().machine); ' +
      'print("Firmware:     " + os.uname().version); ' +
      'print("\\r\\n")\r\n';

    let _this = this;
    if (!this.pyboard.connected) {
      this.terminal.writeln('Please connect to your device');
      return;
    }

    this.pyboard.sendWaitForBlockingAsync(command, command, 30000)
      .catch(err => _this.logger.error('Failed to send command: ' + command));

    // this.pyboard.send_wait_for_blocking(command, command, function(err) {
    //   if (err) {
    //     _this.logger.error('Failed to send command: ' + command);
    //   }
    // });
  }

  // refresh button display based on current status
  setButtonState() {
    this.view.setButtonState(this.runner.busy, this.synchronizing, this
      .synchronize_type);
  }

  setTitle(status) {
    this.view.setTitle();
  }

  connect(address, clickaction) {
    let _this = this;
    this.logger.info('Connecting...');
    this.logger.info(address);

    if (this.autoconnect_address) {
      if (!address) {
        address = this.autoconnect_address;
        this.logger.info('Using autoconnect address: ' + address);
      }
    }
    if (this.settings.auto_connect && !address && clickaction) {
      this.terminal.writeln('AutoConnect: No device available');
    }

    let state = this.api.getConnectionState(address);
    let ts = new Date().getTime();
    if (state && state['project'] != this.view.project_name && state[
        'timestamp'] > ts - 11000) {
      this.terminal.writeln("Already connected in another window (project '" +
        state['project'] + "')");
      return;
    }

    let continueConnect = function() {
      // stop config observer from triggering again
      if (_this.pyboard.connected || _this.pyboard.connecting) {
        _this.logger.info(
          'Still connected or connecting... disconnecting first');
        _this.disconnect(function() {
          _this.continueConnect();
        });
      }
      else {
        _this.continueConnect();
      }
    };

    if (!address && _this.settings.auto_connect) {
      this.getAutoconnectAddress(function(address, manu_unused) {
        _this.pyboard.setAddress(address);
        continueConnect();
      });
    }
    else {
      if (address) {
        _this.pyboard.setAddress(address);
      }
      continueConnect();
    }
  }

  continueConnect() {
    let _this = this;
    this.pyboard.refreshConfig(function() {

      let address = _this.pyboard.address;
      let connect_preamble = '';

      if (address == '' || address == null) {
        if (!_this.settings.auto_connect) {
          _this.terminal.writeln(
            'Address not configured. Please go to the settings to configure a valid address or comport'
            );
        }
      }
      else {
        _this.terminal.writeln(connect_preamble + 'Connecting to ' +
          address + '...');

        let onconnect = function(err) {
          if (err) {
            _this.terminal.writeln('Connection error: ' + err);
          }
          else {
            _this.api.setConnectionState(address, true, _this.view
              .project_name);
            _this.connection_timer = setInterval(function() {
              if (_this.pyboard.connected) {
                _this.api.setConnectionState(address, true, _this
                  .view.project_name);
              }
              else {
                clearTimeout(_this.connection_timer);
              }
            }, 10000);
          }

          _this.setButtonState();
        };

        let onerror = function(err) {
          let message = _this.pyboard.getErrorMessage(err.message);
          if (message == '') {
            message = err.message ? err.message : 'Unknown error';
          }
          if (_this.pyboard.connected) {
            _this.logger.warning('An error occurred: ' + message);
            if (_this.synchronizing) {
              _this.terminal.writeln('An error occurred: ' + message);
              _this.logger.warning('Synchronizing, stopping sync');
              _this.syncObj.stop();
            }
          }
          else {
            _this.terminal.writeln('> Failed to connect (' + message +
              '). Click the "Pico Disconnected" button to try again.');
            _this.setButtonState();
          }
        };

        let ontimeout = function(err) {
          _this.pyboard.connected = false;
          _this.terminal.enter();
          _this.terminal.writeln(
            '> Connection timed out. Click the "Pico Disconnected" button to try again.'
            );
          _this.setButtonState();
        };

        let onmessage = function(mssg) {
          if (!_this.synchronizing) {
            _this.terminal.write(mssg);
          }
        };

        _this.pyboard.connect(address, onconnect, onerror, ontimeout,
          onmessage);
      }
    });
  }

  disconnect(cb) {

    this.logger.info('Disconnecting...');
    if (this.pyboard.isConnecting()) {
      this.terminal.writeln('Connection attempt canceled');
    }

    clearInterval(this.connection_timer);
    this.api.setConnectionState(this.pyboard.address, false);
    this.pyboard.disconnect(function() {
      if (cb) cb();
    });
    this.synchronizing = false;
    this.runner.stop();
    this.setButtonState();

  }

  run() {
    let _this = this;
    if (!this.pyboard.connected) {
      this.terminal.writeln('Please connect your device');
      return;
    }
    if (!this.synchronizing) {

      // this.runner.toggle(function(){
      //   _this.setButtonState()
      // })

      // TODO: fix runselection() feature to work stabily before enabling it with the code below
      let code = this.api.getSelected();
      // if user has selected code, run that instead of the file
      if (code) {
        this.runselection(code);
      }
      else {
        /*
        this.pyboard.soft_reset(function() {
          _this.runner.toggle(function() {
            _this.setButtonState();
          });
        }, 1000);*/
        _this.runner.toggle(function() {
          _this.setButtonState();
        });
      }
    }
  }

  runselection() {
    let _this = this;
    if (!this.pyboard.connected) {
      this.terminal.writeln('Please connect your device');
      return;
    }

    if (!this.synchronizing) {
      let code = this.api.getSelectedOrLine();
      _this.runner.selection(code, function(err) {
        if (err) {
          _this.logger.error('Failed to send and execute codeblock ');
        }
        else {
          //return focus to editor
          _this.api.editorFocus();
        }
      });
    }
  }

  upload() {
    let _this = this;
    if (!this.synchronizing) {
      this.sync();
    }
    else {
      this.stopSync(function() {
        _this.setButtonState();
      });
    }
    this.setButtonState();
  }

  uploadFile() {
    let file = this.api.getOpenFile();

    if (!file.path) {
      this.api.warning('No file open to upload');
    }
    else {
      this.logger.info(file.path);
      this.sync('send', file.path);
    }
  }

  deleteAllFiles() {
    this.logger.info('Delete All Files');
    let _this = this;

    let options = {
      'Cancel': function() {},
      'Yes': function() {
        if (!_this.pyboard.connected) {
          _this.terminal.writeln('Please connect your device');
          return;
        }

        if (!_this.synchronizing) {
          let command =
            'import os\r\n' +
            'def deltree(target):\r\n' +
            '  for d in os.listdir(target):\r\n' +
            "    if target == '/':\r\n" +
            '      current = target + d\r\n' +
            '    else:\r\n' +
            "      current = target + '/' + d\r\n" +
            '    try:\r\n' +
            "      print('Deleting \\'' + current + '\\' ...')\r\n" +
            '      deltree(current)\r\n' +
            '    except OSError:\r\n' +
            '      os.remove(current)\r\n' +
            "  if target != '/':\r\n" +
            '    os.rmdir(target)\r\n' +
            "deltree('/')\r\n" +
            "print('\\r\\nAll files and directories have been deleted from the board.\\r\\n')";
          _this.runner.selection(command, function(err) {
            if (err) {
              _this.logger.error(
                'Failed to send and execute codeblock ');
            }
            else {
              //return focus to editor
              _this.api.editorFocus();
            }
            _this.setButtonState();
          }, true);
        }
      },
    };

    _this.api.confirm('Are you sure you want to delete all files and directories from the board?',
      options);
  }

  download() {
    this.sync('receive');
  }

  sync(type, files) {
    this.logger.info('Sync');
    this.logger.info(type);
    let _this = this;
    if (!this.pyboard.connected) {
      this.terminal.writeln('Please connect your device');
      return;
    }
    if (!this.synchronizing) {
      this.syncObj = new Sync(this.pyboard, this.settings, this.terminal);
      this.synchronizing = true;
      this.synchronize_type = type;
      this.setButtonState();
      let cb = function(err) {

        _this.synchronizing = false;
        _this.setButtonState();
        if (_this.pyboard.type != 'serial') {
          setTimeout(function() {
            _this.connect();
          }, 4000);
        }
      };

      if (type == 'receive') {
        this.syncObj.start_receive(cb);
      }
      else {
        try {
          this.syncObj.start(cb, files);
        }
        catch (e) {
          console.log(e);
        }
      }
    }
  }

  resetSoft() {
    this.pyboard.soft_reset_no_follow(function(err) {});
  }

  resetHard() {
    let _this = this;
    let command = 'import machine\r\nmachine.reset()\r\n';

    if (!this.pyboard.connected) {
      this.terminal.writeln('Please connect to your device');
      return;
    }

    this.pyboard.send(command, function(err) {
      if (err) {
        _this.logger.error('Failed to send command: ' + command);
      }
      else {
        setTimeout(function() {
          _this.terminal.enter();
          _this.disconnect();
          _this.connect();
        }, 1000);
      }
    });
  }

  stopSync(cb) {
    let _this = this;
    _this.logger.info('Stopping upload/download now...');
    if (this.synchronizing) {
      this.syncObj.stop(function() {
        _this.synchronizing = false;
        cb();
      });
      let type = this.synchronize_type == 'receive' ? 'download' : 'upload';
      this.terminal.writeln('Stopping ' + type + '....');
    }
  }

  // VSCode only
  writeGetStartedText() {
    this.terminal.enter();
    this.terminal.write(this.config.start_text);
    this.terminal.writeln('');

    // PySerial.list(this.settings,function(list){
    //   if(list.length > 0){
    //     _this.terminal.writeln("Here are the devices you've connected to the serial port at the moment:")
    //     _this.getSerial()
    //   }else if(this.pyboard.connected){
    //     this.terminal.writeln()
    //     this.terminal.writePrompt()
    //   }
    // })


  }

  // UI Stuff
  addPanel() {
    this.view.addPanel();
  }

  hidePanel() {
    this.view.hidePanel();
    this.logger.verbose('Hiding pannel + disconnect');
    this.disconnect();
  }

  showPanel() {
    this.view.showPanel();
    this.setButtonState();
    this.connect();
  }


  clearTerminal() {
    this.view.clearTerminal();
  }

  // VSCode only
  toggleConnect() {
    this.pyboard.connected ? this.disconnect() : this.connect();
  }


  // Returns an object that can be retrieved when package is activated
  serialize() {
    return { visible: this.view.visible };
  }

  // Tear down any state and detach
  destroy() {
    this.logger.warning('Destroying plugin');
    this.disconnect();
    this.view.removeElement();
  }

  getElement() {
    return this.view.element;
  }

}