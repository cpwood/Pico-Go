'use babel';

import Config from '../config.js';
import Pyserial from '../connections/pyserial';
import Pytelnet from '../connections/pytelnet';
import Pysocket from '../connections/pysocket';
import Authorize from './authorize';
import Logger from '../helpers/logger.js';
//import { Utils as utils } from '../helpers/utils';

let CTRL_A = '\x01'; // raw repl
let CTRL_B = '\x02'; // exit raw repl
let CTRL_C = '\x03'; // ctrl-c
let CTRL_D = '\x04'; // reset (ctrl-d)
//let CTRL_E = '\x05'; // paste mode (ctrl-e)
let CTRL_F = '\x06'; // safe boot (ctrl-f)
//let EOF = '\x04';    // end of file
let repl_entry_waitfor = 'raw REPL; CTRL-B to exit\r\n>';


//statuses
let DISCONNECTED = 0;
//let CONNECTED=1;
let FRIENDLY_REPL = 2;
let RAW_REPL = 3;
let RUNNING_FILE = 4;
//let PASTE_MODE = 5;

export default class Pyboard {

  constructor(settings) {
    this.connected = false;
    this.connecting = false;
    this.receive_buffer = '';
    this.receive_buffer_raw = Buffer.alloc(0);
    this.waiting_for = null;
    this.waiting_for_cb = null;
    this.promise = null;
    this.waiting_for_timeout = 8000;
    this.status = DISCONNECTED;
    this.pingTimer = null;
    this.ping_count = 0;
    this.isSerial = false;
    this.type = null;
    this.settings = settings;
    this.timeout = settings.timeout;
    this.authorize = new Authorize(this);
    this.logger = new Logger('Pyboard');
    this.config = Config.constants();
    this.refreshConfig();
    this.address = null;
  }

  refreshConfig(cb) {
    this.refreshConfigAsync()
      .then(() => {
        if (cb) cb();
      })
      .catch(err => {
        if (cb) cb(err);
      });
  }

  async refreshConfigAsync() {
    await this.settings.refreshAsync();

    this.params = {
      port: 23,
      username: this.settings.username,
      password: this.settings.password,
      enpassword: '',
      timeout: this.settings.timeout,
      ctrl_c_on_connect: this.settings.ctrl_c_on_connect
    };
  }

  setAddress(address) {
    this.address = address;
  }

  getCallbacks() {
    return [this.onmessage, this.onerror, this.ontimeout, this.onmessage];
  }

  startPings(interval) {
    let _this = this;
    this.pingTimer = setInterval(function() {
      _this.connection.sendPing(function(err) {
        if (err) {
          _this.ping_count += 1;
        }
        else {
          _this.ping_count = 0;
        }

        if (_this.ping_count > 1) { // timeout after 2 pings
          _this.ping_count = 0;
          clearInterval(_this.pingTimer);
          _this.ontimeout(new Error('Connection lost'));
          _this.disconnect();
        }
      });
    }, interval * 1000);
  }

  stopPings() {
    clearInterval(this.pingTimer);
  }

  setStatus(status) {
    if (status != this.status) {
      this.status = status;
      if (this.statusListenerCB) {
        this.statusListenerCB(status);
      }
    }
  }

  registerStatusListener(cb) {
    this.statusListenerCB = cb;
  }

  enter_friendly_repl(cb) {
    this.enterFriendlyReplAsync()
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async enterFriendlyReplAsync() {
    await this.sendWaitForBlockingAsync(CTRL_B, '\r\n>>>');
    this.setStatus(FRIENDLY_REPL);
  }

  enter_friendly_repl_wait(cb) {
    this.enterFriendlyReplWaitAsync()
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async enterFriendlyReplWaitAsync() {
    await this.sendWaitForAsync(CTRL_B,
      'Type "help()" for more information.\r\n>>>');
    this.setStatus(FRIENDLY_REPL);
  }

  enter_friendly_repl_non_blocking(cb) {
    
    this.enterFriendlyReplNonBlockingAsync()
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async enterFriendlyReplNonBlockingAsync() {
    await this.sendAsync(CTRL_B);
    this.setStatus(FRIENDLY_REPL);
  }

  soft_reset(cb, timeout) {
    this.softResetAsync()
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async softResetAsync(timeout) {
    if (!timeout) {
      timeout = 5000;
    }
    this.logger.info('Soft reset');
    let wait_for = this.status == RAW_REPL ? '>' : 'OK';
    return await this.sendWaitForBlockingAsync(CTRL_D, wait_for, timeout);
  }

  soft_reset_no_follow(cb) {
    this.softResetNoFollowAsync()
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async softResetNoFollowAsync() {
    this.logger.info('Soft reset no follow');
    await this.sendAsync(CTRL_D);
  }

  safe_boot(cb, timeout) {
    this.safeBootAsync(timeout)
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async safeBootAsync(timeout) {
    this.logger.info('Safe boot');
    await this.sendWaitForAsync(CTRL_F,
      'Type "help()" for more information.\r\n>>>', timeout);
  }

  stop_running_programs(cb) {
    this.stopRunningProgramsAsync()
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async stopRunningProgramsAsync() {
    if (this.status != RAW_REPL)
      await this.sendWaitForAsync(CTRL_C, '>>>', 5000);
  }

  stop_running_programs_double(cb, timeout) {
    this.stopRunningProgramsDoubleAsync(timeout)
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async stopRunningProgramsDoubleAsync(timeout) {
    if (this.status != RAW_REPL)
      await this.sendWaitForAsync(CTRL_C + CTRL_C, '>>>', timeout);
  }

  stop_running_programs_nofollow(cb) {
    this.stopRunningProgramsNoFollowAsync()
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async stopRunningProgramsNoFollowAsync() {
    this.logger.info('CTRL-C (nofollow)');
    if (this.status != RAW_REPL)
      await this.sendWithEnterAsync(CTRL_C);
  }

  enter_raw_repl_no_reset(cb) {
    this.enterRawReplNoResetAsync()
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async enterRawReplNoResetAsync() {
    try {
      await this.flushAsync();

      this.logger.info('Entering raw repl');

      await this.sendWaitForBlockingAsync(CTRL_A,
        repl_entry_waitfor, 5000);
      this.setStatus(RAW_REPL);
    }
    catch (err) {
      this.promise.reject(err);
    }
  }

  /*
  enter_raw_repl(callback) {
    let _this = this;
    // eslint-disable-next-line no-unused-vars
    this.enter_raw_repl_no_reset(function(err) {
      _this.flush(function() {
        // eslint-disable-next-line no-unused-vars
        _this.soft_reset(function(err) {
          callback();
        }, 5000);
      });
    });
  }
*/

  isConnecting() {
    return this.connecting && !this.connected;
  }

  connect_raw(cb, onerror, ontimeout, onmessage) {
    this.connect(cb, onerror, ontimeout, onmessage, true);
  }

  connect(address, callback, onerror, ontimeout, onmessage, raw) {
    this.connectAsync(address, callback, onerror, ontimeout, onmessage, raw);
  }

  async connectAsync(address, callback, onerror, ontimeout, onmessage, raw) {
    this.connecting = true;
    this.onconnect = callback;
    this.onmessage = onmessage;
    this.ontimeout = ontimeout;
    this.onerror = onerror;
    this.address = address;
    this.stopWaitingForSilent();
    this.refreshConfig();
    this.isSerial = await Pyserial.isSerialPortAsync(this.address);

    if (this.isSerial) {
      this.connection = new Pyserial(this.address, this.params, this.settings);
    }
    else if (raw) {
      this.connection = new Pysocket(this.address, this.params);
    }
    else {
      this.connection = new Pytelnet(this.address, this.params);
    }

    this.type = this.connection.type;

    if (this.connection.type == 'telnet') {
      this.authorize.run(function(error) {
        if (error) {
          this._disconnected();
          callback(error);
        }
        else {
          this._onconnect(callback);
        }
      });
    }

    let _this = this;

    await this.connection.connectAsync(
      // onconnect
      function() {
        _this.connection.registerListener(function(mssg, raw) {
          _this.receive(mssg, raw);
        });
        if (_this.connection.type != 'telnet') {
          _this._onconnect(callback);
        }
      },
      // onerror
      function(err) {
        _this._disconnected();
        _this.onerror(err);
      },
      // ontimeout
      function(mssg) {
        // Timeout callback only works properly during connect
        // after that it might trigger unneccesarily
        if (_this.isConnecting()) {
          _this._disconnected();
          ontimeout(mssg, raw);
        }
      });
  }

  _onconnect(cb) {
    this.connected = true;
    this.connection.connected = true;

    this.connecting = false;

    if (this.params.ctrl_c_on_connect && this.type != 'socket') {
      this.stop_running_programs(cb);
    }
    else {
      cb();
    }
    this.startPings(5);
  }

  _disconnected(cb) {
    this._disconnectedAsync()
      .then(() => {
        if (cb) cb();
      });
  }

  async _disconnectedAsync() {
    if (this.connection) {
      await this.connection.disconnectAsync();
    }
    this.connecting = false;
    this.connected = false;
    this.stopPings();
  }

  getWaitType() {
    let type = Object.prototype.toString.call(this.waiting_for);

    switch(type){
      case '[object RegExp]':
        return 'regex';
      case '[object String]':
        return 'literal';
      case '[object Number]':
        return 'length';
      default:
        throw new Error('Unknown wait type');
    }
  }

  receive(mssg, raw) {
    this.logger.silly('Received message: ' + mssg);
    if (!this.wait_for_block && typeof mssg != 'object' && this.onmessage !=
      undefined) {
      this.onmessage(mssg);
    }
    let err_in_output = this.getErrorMessage(mssg);

    this.receive_buffer += mssg;
    this.receive_buffer_raw = Buffer.concat([this.receive_buffer_raw, raw]);

    if (this.receive_buffer.length > 80000) {
      this.receive_buffer = this.receive_buffer.substr(40000);
    }

    if (this.receive_buffer_raw.length > 80000) {
      this.receive_buffer_raw = this.receive_buffer_raw.slice(40000);
    }

    this.logger.silly('Buffer length now ' + this.receive_buffer.length);

    if (err_in_output != '') {
      this.logger.silly('Error in output: ' + err_in_output);
      let err = new Error(err_in_output);
      if (this.waiting_for != null) {
        this.stopWaitingFor(this.receive_buffer, this.receive_buffer_raw,
          err);
      }
      else {
        this.onerror(err);
      }

    }
    else if (this.waiting_for != null && mssg) {
      this.logger.silly('Waiting for ' + this.waiting_for);
      if (this.receive_buffer === undefined) this.receive_buffer = '';
      if (this.receive_buffer.indexOf('Invalid credentials, try again.') > -
        1) {
        this._disconnected();
        this.onconnect('Invalid credentials');
        this.stopWaitingForSilent();
        this.wait_for_blocking('Login as:', function() {
          // do nothing
        });
      }

      if (this.getWaitType() == 'length') {
        this.logger.silly('Waiting for ' + this.waiting_for + ', got ' + this
          .receive_buffer.length + ' so far');
        if (this.receive_buffer.length >= this.waiting_for) {
          this.stopWaitingFor(this.receive_buffer, this.receive_buffer_raw);
        }
      }
      else if (this.getWaitType() == 'literal' && (this.status == RAW_REPL || this.receive_buffer.indexOf(repl_entry_waitfor) >= 0) && (this.receive_buffer.indexOf(this.waiting_for) > -1 || this
        .receive_buffer_raw.indexOf(this.waiting_for) > -1)) {
        let trail = this.receive_buffer.split(this.waiting_for).pop(-1);
        if (trail && trail.length > 0 && this.wait_for_block) {
          this.onmessage(trail);
        }
        this.stopWaitingFor(this.receive_buffer, this.receive_buffer_raw);
      }
      else if (this.getWaitType() == 'literal' && this.status != RAW_REPL && (this.receive_buffer.indexOf(this.waiting_for) > -1 || this
        .receive_buffer_raw.indexOf(this.waiting_for) > -1) && (this.receive_buffer.indexOf('>>> ') > -1 || this
        .receive_buffer_raw.indexOf('>>> ') > -1)) {
        let trail = this.receive_buffer.split(this.waiting_for).pop(-1);
        if (trail && trail.length > 0 && this.wait_for_block) {
          this.onmessage(trail);
        }
        this.stopWaitingFor(this.receive_buffer, this.receive_buffer_raw);
      }
      else if (this.getWaitType() == 'regex' && (this.waiting_for.test(this.receive_buffer) || 
        this.waiting_for.test(this.receive_buffer_raw))) {
      let trail = this.receive_buffer.split(this.waiting_for).pop(-1);
      if (trail && trail.length > 0 && this.wait_for_block) {
        this.onmessage(trail);
      }
      this.stopWaitingFor(this.receive_buffer, this.receive_buffer_raw);
    }
    }
  }

  stopWaitingForSilent() {
    let promise = this.promise;

    clearTimeout(this.waiting_for_timer);
    this.waiting_for = null;
    this.wait_for_block = false;
    this.promise = null;

    return promise;
  }

  stopWaitingFor(msg, raw, err) {
    this.logger.silly('Stopping waiting for, got message of ' + msg.length +
      ' chars');

    let promise = this.stopWaitingForSilent();

    if (promise) {
      // This is a promise-based command.
      if (err) {
        promise.reject(err);
      }
      else {
        promise.resolve({
          msg: msg,
          raw: raw
        });
      }
    }
    else if (this.waiting_for_cb) {
      // This is an olds-school callback.
      this.waiting_for_cb(err, msg, raw);
    }
    else {
      this.logger.silly('No callback after waiting');
    }
  }

  disconnect(cb) {
    this.disconnectAsync()
      .then(() => {
        if (cb) cb();
      })
      .catch(err => {
        if (cb) cb(err);
      });
  }

  disconnect_silent(cb) {
    this.disconnectSilentAsync()
      .then(() => {
        if (cb) cb();
      })
      .catch(err => {
        if (cb) cb(err);
      });
  }

  async disconnectAsync() {
    await this.disconnectSilentAsync();
    this.setStatus(DISCONNECTED);
  }

  async disconnectSilentAsync() {
    await this._disconnectedAsync();
  }

  run(filecontents, cb) {
    this.runAsync(filecontents)
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async runAsync(code) {
    await this.stopRunningProgramsAsync();
    await this.enterRawReplNoResetAsync();

    this.setStatus(RUNNING_FILE);

    code += '\r\nimport time';
    code += '\r\ntime.sleep(0.1)';

    // executing code delayed (20ms) to make sure _this.wait_for(">") is executed before execution is complete
    let response = await this.execRawAsync(code + '\r\n');
    this.waitForAsync('>');
    await this.enterFriendlyReplWaitAsync();
    return response;
  }

  send(mssg, cb) {
    if (this.connection) {
      this.connection.send(mssg, cb);
    }
  }

  async sendAsync(msg) {
    if (this.connection) {
      await this.connection.sendAsync(msg);
    }
  }

  send_with_enter(mssg, cb) {
    this.sendWithEnterAsync(mssg)
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async sendWithEnterAsync(msg) {
    if (this.connection) {
      await this.connection.sendAsync(msg);
    }
  }
  /*
    send_cmd(cmd, cb) {
      let mssg = '\x1b' + cmd;
      let data = Buffer.from(mssg, 'binary');
      this.connection.send_raw(data, cb);
    }

    send_cmd_read(cmd, wait_for, cb, timeout) {

      if (typeof wait_for == 'string') {
        wait_for = '\x1b' + wait_for;
        wait_for = Buffer.from(wait_for, 'binary');
      }
      this.read(wait_for, cb, timeout);
      this.send_cmd(cmd);
    }

    send_cmd_wait_for(cmd, wait_for, cb, timeout) {

      if (typeof wait_for == 'string') {
        wait_for = '\x1b' + wait_for;
        wait_for = Buffer.from(wait_for, 'binary');
      }
      this.wait_for(wait_for, cb, timeout);
      this.send_cmd(cmd, function() {

      });
    }
  */
  send_user_input(mssg, cb) {
    this.sendUserInputAsync(mssg)
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async sendUserInputAsync(msg) {
    await this.sendAsync(msg);

    if (msg == CTRL_A) {
      this.status = RAW_REPL;
    }
    else if (msg == CTRL_B) {
      this.status = FRIENDLY_REPL;
    }
  }

  /*
    send_raw_wait_for(mssg, wait_for, cb, timeout) {
      this.wait_for(wait_for, cb, timeout);
      this.send_raw(mssg);
    }
  */
  send_wait_for(mssg, wait_for, cb, timeout) {
    this.sendWaitForAsync(mssg, wait_for, timeout)
    .then(response => {
      if (cb) cb(null, response);
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async sendWaitForAsync(mssg, wait_for, timeout) {
    return new Promise((resolve, reject) => {
      this.waitForAsync(
        wait_for, {
          resolve: resolve,
          reject: reject
        },
        timeout);

      this.send_with_enter(mssg);
    });
  }

  send_wait_for_blocking(mssg, wait_for, cb, timeout) {
    this.sendWaitForBlockingAsync(mssg, wait_for, timeout)
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async  sendWaitForBlockingAsync(mssg, wait_for, timeout) {
    return new Promise((resolve, reject) => {
      this.waitForBlockingAsync(
        wait_for, {
          resolve: resolve,
          reject: reject
        },
        timeout);

      this.send_with_enter(mssg);
    });
  }

  wait_for_blocking(wait_for, cb, timeout) {
    // Can't point this to the asyncified version.
    this.wait_for(wait_for, cb, timeout);
    this.wait_for_block = true;
  }

  waitForBlockingAsync(wait_for, promise, timeout) {
    this.waitForAsync(wait_for, promise, timeout);
    this.wait_for_block = true;
  }
  /*
    send_read(mssg, number, cb, timeout) {
      this.read(number, cb, timeout);
      this.send_with_enter(mssg);
    }

    read(number, cb, timeout) {
      this.wait_for_blocking(number, cb, timeout, 'length');
    }
    */

  wait_for(wait_for, cb, timeout, clear = true) {
    this.wait_for_block = false;
    this.waiting_for = wait_for;
    this.waiting_for_cb = cb;
    this.waiting_for_timeout = timeout;
    if (clear) {
      this.receive_buffer = '';
      this.receive_buffer_raw = Buffer(0);
    }


    let _this = this;
    clearTimeout(this.waiting_for_timer);
    if (timeout) {
      this.waiting_for_timer = setTimeout(function() {
        if (_this.waiting_for_cb) {
          let tmp_cb = _this.waiting_for_cb;
          _this.waiting_for_cb = null;
          _this.wait_for_block = false;
          _this.waiting_for = null;
          _this.receive_buffer = '';
          _this.receive_buffer_raw = Buffer(0);
          tmp_cb(new Error('timeout'), _this.receive_buffer);
        }
      }, timeout);
    }
  }

  waitForAsync(wait_for, promise, timeout, clear = true) {
    this.wait_for_block = false;
    this.waiting_for = wait_for;
    this.promise = promise;
    this.waiting_for_timeout = timeout;
    if (clear) {
      this.receive_buffer = '';
      this.receive_buffer_raw = Buffer(0);
    }

    let _this = this;
    clearTimeout(this.waiting_for_timer);
    if (timeout) {
      this.waiting_for_timer = setTimeout(function() {
        if (_this.waiting_for_cb) {
          let temp = _this.promise;
          _this.waiting_for_cb = null;
          _this.promise = null;
          _this.wait_for_block = false;
          _this.waiting_for = null;
          _this.receive_buffer = '';
          _this.receive_buffer_raw = Buffer(0);
          temp.reject(new Error('timeout'), _this.receive_buffer);
        }
      }, timeout);
    }
  }

  /*
  follow(cb) {
    this.logger.verbose('Following up...');
    cb(null, '');
  }
*/

//====================================
  async xxSend(command) {
    if (this.connection)
      await this.connection.sendAsync(command);
  }

  async xxSendWait(command, waitFor = null, timeout = 5000) {
    let _this = this;
    let result = null;

    if (!waitFor)
      waitFor = this.status == RAW_REPL ? '>' : command;

    if (!command.endsWith('\r\n'))
      command += '\r\n';

      // If we're waiting for a response, we need to
      // run the commands we've sent if we're in 
      // raw REPL.
    if (this.status == RAW_REPL)
      command += CTRL_D;

    let promise = new Promise((resolve, reject) => {
      this.waitForBlockingAsync(
        waitFor, {
          resolve: resolve,
          reject: reject
        },
        timeout);

      _this.xxSend(command);
    });

    result = await promise; 
    let received = result.msg;

    if (this.status == RAW_REPL) {
      if (received.startsWith('OK'))
        received = received.substr(2);
    
      // EOT - End of Transmission ASCII character.
      if (received.indexOf('\u0004') >= 0)
        received = received.substr(0, received.indexOf('\u0004'));
    }
    else {
      if (received.startsWith(command)) {
        received = received.substr(command.length);
      }

      if (received.endsWith('>>> '))
        received = received.substr(0, received.length - 4);
    }


    return received;
  }


//====================================

  send_raw(mssg, cb) {
    this.sendRawAsync(mssg)
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async sendRawAsync(msg) {
    if (this.connection) {
      await this.connection.sendRawAsync(msg);
    }
  }

  exec_raw_no_reset(code, cb) {
    this.execRawNoResetAsync(code)
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async execRawNoResetAsync(code) {
    this.logger.verbose('Executing code:' + code);
    let data = Buffer.from(code, 'binary');
    await this.sendRawAsync(data);
  }
  /*
    exec_raw_delayed(code, cb, timeout) {
      let _this = this;
      setTimeout(function() {
        _this.exec_raw(code, cb, timeout);
      }, 50);
    }

    async execRawDelayedAsync(code, timeout) {
      await utils.sleep(50);
      await this.execRawAsync(code, timeout);
    }
  */
  exec_raw(code, cb, timeout) {
    this.execRawAsync(code, timeout)
    .then(ret => {
      if (cb) cb(null, ret);
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async execRawAsync(code, timeout) {
    await this.execRawNoResetAsync(code);
    let response = await this.softResetAsync(timeout);
    return response.msg;
  }

  exec_(code, cb) {
    this.execAsync_(code)
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async execAsync_(code) {
    await this.execRawNoResetAsync('\r\n' + code);
    this.logger.silly('Executed code, now resetting');
    this.softResetAsync();
  }

  flush(cb) {
    this.flushAsync()
    .then(() => {
      if (cb) cb();
    })
    .catch(err => {
      if (cb) cb(err);
    });
  }

  async flushAsync() {
    if (this.connection) {
      await this.connection.flushAsync();
    }
  }

  getErrorMessage(text) {
    let messages = this.config.error_messages;
    for (let key in messages) {
      if (text.indexOf(key) > -1) {
        return messages[key];
      }
    }
    return '';
  }
}