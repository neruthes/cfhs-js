const os = require('os');
const fs = require('fs');
const http = require('http');
const sh = require('child_process').execSync;

// --------------------------------------------
// Arguments
// --------------------------------------------
const ITNAME = process.argv[2];
console.log(ITNAME);

// --------------------------------------------
// Global variables
// --------------------------------------------
const HOME = os.homedir();
let GlobalConf = {};
let InstanceConf = {};
let TokensList = [];
let TokensDict = [];
let DirsList = [];

// --------------------------------------------
// Lib functions
// --------------------------------------------
const parseConf = function (txt) {
    return {
        'Port': 1453
    };
};
const updateTokensDB = function (txt) {
    TokensList = [];
    TokensDict = {};
    txt.split('\n').map(function (line) {
        if (line[0] === '#') {
            return 0;
        };
        lineObj = line.split(',');
        let tokenItem = {
            'Timestamp': lineObj[0],
            'Type': lineObj[1],
            'Token': lineObj[2],
            'Path': lineObj[3],
            'Expiry': lineObj[4],
            'ExpiryTS': (new Date(lineObj[4])).getTime();
        };
        if (tokenItem.Type === 'V' && tokenItem.ExpiryTS + 24*3600*1000 < Date.now()) {
            console.log(`[INFO] Token '${tokenItem.Token}' has expired for 24 hours. Will not keep it.`);
            return 0;
        };
        TokensList.push(tokenItem);
        TokensDict[tokenItem.Token] = tokenItem;
    });
};
const serializeTokens = function (arr) {
    return arr.map(function (tokenItem, i) {
        return [
            tokenItem.Timestamp,
            tokenItem.Type,
            tokenItem.Token,
            tokenItem.Path,
            tokenItem.Expiry
        ].join(',')
    }).join('\n');
};
const dumpTokens = function (arr) {
    // return 0;
};
const parseDirs = function (txt) {
    return [
        '/tmp/httpd-1',
        '/tmp/httpd-2'
    ]
};
const readConfAndUpdate = function() {
    let InstanceConf_txt = fs.readFileSync(`${HOME}/.config/cfhs-js/${ITNAME}/conf`).toString().trim();
    console.log(InstanceConf_txt);
    InstanceConf = parseConf(InstanceConf_txt);

    let TokensDB_txt = fs.readFileSync(`${HOME}/.config/cfhs-js/${ITNAME}/tokens`).toString().trim();
    updateTokensDB(TokensDB_txt);

    let DirsList_txt = fs.readFileSync(`${HOME}/.config/cfhs-js/${ITNAME}/dirs`).toString().trim();
    DirsList = parseDirs(DirsList_txt);
};
const newToken = function (tokenType, authPath, expiryDate) {
    let tokenUuid = sh('uuidgen').toString();
    console.log(`Added new token: ${tokenUuid}`);
    TokensDB.push({
        'Type': tokenType,
        'Token': tokenUuid,
        'Path': authPath,
        'Expiry': expiryDate
    });
    // dumpTokens();
    // return tokenUuid;
};
const validateToken = function (candidateToken) {
    if (TokensDict[candidateToken]) {
        return true;
    };
};

// --------------------------------------------
// Initialization
// --------------------------------------------
readConfAndUpdate();
newToken();
newToken();
newToken();
console.log(serializeTokens(TokensDB));

// --------------------------------------------
// Configuration watchdog
// --------------------------------------------
setInterval(function () {
    console.log('[INFO] Configuration watchdog invocation');
}, 5000);

// --------------------------------------------
// HTTP server
// --------------------------------------------
