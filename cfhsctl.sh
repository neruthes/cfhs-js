#!/bin/bash

# Subcommands:
#       help, ls, new, start, end, getpid

###################################

### Constants
DDIR=$HOME/DEV/cfhs-js
PIDF=/run/cfhs-js.pid

### Create ~/.config dirs
CONFDIR=$HOME/.config/cfhs-js
mkdir -p $CONFDIR/.src

### Lib funtions
function _createinstance() {
    ITNAME=$1
    if [[ -e $CONFDIR/$ITNAME ]]; then
        echo "Error: Instance '$ITNAME' already exists!"
        return 1
    fi
    mkdir -p $CONFDIR/$ITNAME
    echo "Port=1453" > $CONFDIR/$ITNAME/conf
    printf "# Add a list of directories here...\n# Lines starting with # will be ignored.\n/tmp/cfhs-$ITNAME\n" > $CONFDIR/$ITNAME/dirs
    printf '# Append ":abcd" to let it appear as "abcd" in the root index\n' >> $CONFDIR/$ITNAME/dirs
    LONGTIME="$(date -Is)"
    NOWYEAR="${LONGTIME:0:4}"
    NEWYEAR="$(($NOWYEAR + 10))"
    SHORTTIME="${LONGTIME:4:15}"
    echo "114514,A,$(uuidgen),/,$NEWYEAR$SHORTTIME" > $CONFDIR/$ITNAME/tokens
}
function _mkdefault() {
    _createinstance default
    echo "Created the default instance at $CONFDIR/default:"
    ls -lah $CONFDIR/default
}
function _help() {
    echo "cfhsctl (0.1.0)"
    echo ""
    echo "Synopsis:"
    echo "    cfhsctl SUBCOMMAND arg0 arg1"
    echo ""
    echo "Subcommands:"
    echo "    help                      Show help message."
    echo "    ls                        List instances."
    echo "    new INSTANCE_NAME         Create new instance."
    echo "    start INSTANCE_NAME       Start an instance."
    echo "    end INSTANCE_NAME         End an instance."
    echo "    newtoken INSTANCE_NAME    Add a new token for instance."
    echo "    newadmintoken INSTANCE_NAME       Add a new admin token for instance."
    echo ""

    if [[ "$(ls $CONFDIR)" == "" ]]; then
        echo "Hint:"
        echo "    You do not have any instance yet."
        echo "    Run 'cfhsctl new my_instance_name' to create one."
    fi
}
function _ls() {
    ls -1 $CONFDIR
}
function _new() {
    _createinstance $ARG0
}
function _start() {
    ITNAME=$1
    PID="$$"
    echo "$PID" > $PIDF.$ITNAME
    echo "Starting instance '$ITNAME' at PID '$PID'..."
    echo "You may run 'kill -9 $PID' to terminate the process."
    exec node $DDIR/serverd.js $ITNAME
}


### Main

SUBCOMMAND=$1
ARG0=$2
ARG1=$3
ARG2=$4

### Testing
# _mkdefault
# exit 0

case $SUBCOMMAND in
    h|help )
        _help
        ;;
    md|mkdefault )
        _mkdefault
        ;;
    ls )
        _ls
        ;;
    n|new )
        _new $ARG0
        ;;
    s|start )
        _start $ARG0
        ;;
    e|end )
        _end $ARG0
        ;;
    nt|newtoken )
        _newtoken $ARG0
        ;;
    nat|newadmintoken )
        _newadmintoken $ARG0
        ;;
    * )
        _help
        ;;
esac
