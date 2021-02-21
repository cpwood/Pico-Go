export default class ShellWorkerResult {
    constructor(value, done) {
        this._value = value;
        this._done = done;
    }
    
    get value() {
        return this._value;
    }

    get done() {
        return this._done;
    }
}