Shell is something that's started and stopped, rather than being there all the time. It puts the mode into Raw REPL when it's instantiated, and puts it back in Friendly REPL when it's closed down.

In Raw REPL, you can enter multiple commands separated by line breaks, and when you press `Ctrl+D` it will execute that code, initially acknowledging with `OK`, giving any output and then returning a Raw REPL `>` prompt.

It's also possible to run a block of code in Raw REPL by using the `pyboard.runAsync()` method. This switches to Raw REPL, runs the code by sending `Ctrl+D`, grabs the response and puts the console back into Friendly REPL.

Friendly REPL is the default mode so the user can type things via the UI.

Looks like it's possible for something to fail and the user be stuck in Raw REPL, though might be able to exit with a `Ctrl+D`.

