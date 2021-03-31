#!/bin/bash

# Subcommands:
#       help, ls, new, start, end, getpid

###################################

### Constants
DDIR=$HOME/DEV/cfhs-js
RUNDIRPREF=/tmp/run/cfhs-js
# mkdir -p $RUNDIRPREF./$USER

### Create ~/.config dirs
CONFDIR=$HOME/.config/cfhs-js
mkdir -p $CONFDIR/.src

### Helper funtions
function _chalk() {
    COLOR=$1
    MSG=$2
    printf "\e[${COLOR}m${MSG}\e[0m"
}
function _padRight() {
    STR=$1
    LEN=$2
    PAD=$3
    if [[ "$LEN" -lt "${#STR}" ]]; then
        printf "$STR"
    else
        printf "$STR"
        COUNT="${#STR}"
        while [[ "$COUNT" != "$LEN" ]]; do
            printf "$PAD"
            COUNT=$((COUNT+1))
        done
    fi
}

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
    echo "cfhs-js-ctl (0.1.3)"
    echo ""
    echo "Synopsis:"
    echo "    cfhs-js-ctl SUBCOMMAND arg0 arg1"
    echo ""
    echo "Subcommands:"
    echo "    help                              Show help message."
    echo "    ls                                List instances."
    echo "    new INSTANCE_NAME                 Create new instance."
    echo "    start INSTANCE_NAME               Start an instance."
    echo "    end INSTANCE_NAME                 End an instance."
    echo "    status INSTANCE_NAME              Check instance status."
    echo "    status-all                        Take a look at all instances."
    echo "    newtoken INSTANCE_NAME            Add a new token for instance."
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
function _printStatusLine() {
    ITNAME=$1
    PIDFILEPATH="${RUNDIRPREF}.pid/${USER}/${ITNAME}"
    # echo "$ITARR hello world"
    if [[ -e "$PIDFILEPATH" ]]; then
        #statements
        # echo "  $(_chalk 34 "Working")   $(_padRight $ITNAME 22 ' ')$(cat "$PIDFILEPATH")"
        echo "  $(_chalk '38;5;118' "Working")      $(_padRight $ITNAME 22 ' ')$(cat "$PIDFILEPATH")"
    else
        echo "  Dormant      $ITNAME"
    fi
}
function _statusAll() {
    ITARR=$(ls -1 $CONFDIR)
    echo "List of instances:"
    echo ""
    echo "  Status       Name                  PID"
    echo "  ------------------------------------------"
    for ITNAME in $ITARR; do
        _printStatusLine "$ITNAME"
    done
}
function _new() {
    _createinstance $ARG0
}
function _start() {
    ITNAME=$1

    PIDFILEPATH="${RUNDIRPREF}.pid/${USER}/${ITNAME}"
    LOGPATH="${RUNDIRPREF}.log/${USER}/${ITNAME}"
    mkdir -p "${RUNDIRPREF}.pid/${USER}"
    mkdir -p "${RUNDIRPREF}.log/${USER}"
    mkdir -p "${RUNDIRPREF}.imgcache/${USER}/${ITNAME}"

    if [[ -e "$PIDFILEPATH" ]]; then
        echo "ERROR:"
        echo "    The instance is already running at PID $(cat "$PIDFILEPATH")."
        echo "    Please check 'ps ax | grep $(cat "$PIDFILEPATH")' to check details."
        echo "    If you believe that the instance is not running, you may run"
        echo "    command 'rm $PIDFILEPATH' to force starting the instance."
    else
        nohup cfhs-js-serverd run "${ITNAME}" >$LOGPATH 2>&1 &
        sleep 2
        PID="$(cat $PIDFILEPATH)"
        echo 'Starting instance "'$ITNAME'" at PID '$PID'...'
        echo "Logs are available at $LOGPATH"
    fi
}
function _end() {
    ITNAME=$1

    PIDFILEPATH="${RUNDIRPREF}.pid/${USER}/${ITNAME}"
    LOGPATH="${RUNDIRPREF}.log/${USER}/${ITNAME}"
    if [[ -e "$PIDFILEPATH" ]]; then
        PID="$(cat "$PIDFILEPATH")"
        ps ax | grep "$PID"
        echo "... Is this process ($PID) PID correct?"
        printf "Your answer (y/n) > "
        UANSWER=n
        read UANSWER
        if [[ "${UANSWER:0:1}" == "y"* ]]; then
            kill -9 "$PID"
            rm "$PIDFILEPATH"
            echo "Killed instance '$ITNAME' at PID $PID"
        fi
    else
        echo "PID file does not exist. Is it really running?"
    fi
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
        _new "$ARG0"
        ;;
    conf )
        nano "$CONFDIR/$ARG0/conf"
        ;;
    dirs )
        nano "$CONFDIR/$ARG0/dirs"
        ;;
    tokens )
        less "$CONFDIR/$ARG0/tokens"
        ;;
    s|start )
        _start "$ARG0"
        ;;
    e|end )
        _end "$ARG0"
        ;;
    r|restart )
        _end "$ARG0"
        _start "$ARG0"
        ;;
    log )
        cat "${RUNDIRPREF}.log/${USER}/${ARG0}"
        ;;
    tail )
        tail -f "${RUNDIRPREF}.log/${USER}/${ARG0}"
        ;;
    sa|status-all )
        _statusAll
        ;;
    st|status )
        _printStatusLine $ARG0
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
