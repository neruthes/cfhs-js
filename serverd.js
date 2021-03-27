const os = require('os');
const fs = require('fs');
const http = require('http');
const sh = require('child_process').execSync;

// --------------------------------------------
// Arguments
// --------------------------------------------
const ITNAME = process.argv[2];
console.log(`Starting instance: ~/.config/cfhs-js/${ITNAME}`);

// --------------------------------------------
// Global variables
// --------------------------------------------
const HOME = os.homedir();
let GlobalConf = {};
let InstanceConf = {};
let TokensList = [];
let TokensDict = [];
let DirsDict = [];

// --------------------------------------------
// Lib functions
// --------------------------------------------
const parseConf = function (txt) {
    return {
        'Port': 1453,
        'UrlPrefix': 'http://127.0.0.1:1453',
        'ExternalUrlPrefix': 'http://10.0.233.27:1453'
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
            'ExpiryTS': (new Date(lineObj[4])).getTime()
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
    // console.log(serializeTokens(TokensList));
    // Dump TokensDB
    fs.writeFileSync(`${HOME}/.config/cfhs-js/${ITNAME}/tokens`, serializeTokens(TokensList));
};
const parseDirs = function (txt) {
    let localDirsDict = {};
    txt.split('\n').filter(x=>x[0]!=='#').map(function (line) {
        // console.log(`parseDirs line: ${line}`);
        if (line.indexOf(':')) {
            // Has aname declaration
            let lineArr = line.split(':');
            // console.log(`lineArr: ${lineArr}`);
            localDirsDict[lineArr[1]] = lineArr[0];
        } else {
            // Use the base name
            let baseName = line.split('/').reverse()[0];
            localDirsDict[baseName] = lineArr[0];
        };
    });
    return localDirsDict;
};
const readConfAndUpdate = function() {
    console.log(`EXEC readConfAndUpdate`);
    let InstanceConf_txt = fs.readFileSync(`${HOME}/.config/cfhs-js/${ITNAME}/conf`).toString().trim();
    console.log(InstanceConf_txt);
    InstanceConf = parseConf(InstanceConf_txt);

    // Read TokensDB
    let TokensDB_txt = fs.readFileSync(`${HOME}/.config/cfhs-js/${ITNAME}/tokens`).toString().trim();
    updateTokensDB(TokensDB_txt);

    // Try finding an admin token
    if (TokensList.filter(x=>x.Type === 'A').length === 0) {
        newToken('A', '/', 10*365*24*3600*1000);
    };

    // Read dirs list
    let DirsList_txt = fs.readFileSync(`${HOME}/.config/cfhs-js/${ITNAME}/dirs`).toString().trim();
    DirsDict = parseDirs(DirsList_txt);
};
const newToken = function (tokenType, authPath, expiryOffsetMs) {
    let tokenUuid = sh('uuidgen').toString().trim();
    console.log(`Added new token: ${tokenUuid}`);
    expiryDateObj = (new Date(Date.now() + expiryOffsetMs));
    console.log(expiryDateObj);
    TokensList.push({
        'Timestamp': Date.now().toString(),
        'Type': tokenType,
        'Token': tokenUuid,
        'Path': authPath,
        'ExpiryTS': expiryDateObj.getTime(),
        'Expiry': expiryDateObj.toISOString().slice(0,19)
    });
    dumpTokens();
    return tokenUuid;
    // dumpTokens();
    // return tokenUuid;
};
// newToken('V', '/', 24*3600*7);
// console.log(TokensList);
const validateToken = function (candidateToken, desiredType, attemptingPath) {
    // console.log(TokensDict[candidateToken]);
    if (!TokensDict[candidateToken]) {
        console.log(`validateToken: fail: No such token ${candidateToken}`);
        return false;
    };
    if (TokensDict[candidateToken].ExpiryTS < Date.now()) {
        console.log(`validateToken: fail: Expired ${candidateToken}`);
        return false;
    };
    if (desiredType === 'A' && TokensDict[candidateToken].Type === 'V') {
        console.log(`validateToken: fail: Needs admin but is visitor ${candidateToken}`);
        return false;
    };
    if (attemptingPath && attemptingPath.indexOf(TokensDict[candidateToken].Path) !== 0) {
        console.log(`validateToken: fail: Not within authorized scope ${candidateToken}`);
        return false;
    };
    console.log(`validateToken: success: ${candidateToken}`);
    return true;
};
const getRealFsPath = function (reqPathArr) {
    // console.log(`666 reqPathArr: ${reqPathArr}`);
    // if (reqPathArr[0] === '') {
        // return ''
    // }
    let arr = reqPathArr.slice(0);
    arr[0] = DirsDict[arr[0]];
    console.log(`File path for ${reqPathArr} is at ${arr.join('/')}`);
    return arr.join('/');
};
const getDirSubdirs = function (source) {
    // console.log(`9111 source, ${source}`);
    // console.log(typeof source);
    return fs.readdirSync(source, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
};
const getDirFiles = function (source) {
    return fs.readdirSync(source, { withFileTypes: true })
        .filter(dirent => dirent.isFile())
        .map(dirent => dirent.name);
};

// --------------------------------------------
// Initialization
// --------------------------------------------
readConfAndUpdate();

// --------------------------------------------
// Configuration watchdog
// --------------------------------------------
setInterval(function () {
    console.log('[INFO] Configuration watchdog invocation');
    readConfAndUpdate();
}, 3000);
console.log(DirsDict);

// --------------------------------------------
// Response categories
// --------------------------------------------
const makeResponse = {};
makeResponse.bad = function (res, options) {
    res.writeHead(404);
    if (options.reqPathArr) {
        res.end(`404 Not Found: /${options.reqPathArr.join('/')}`);
    } else {
        res.end(`404 Not Found: ${options.reqPath}`);
    };
};
makeResponse.deny = function (res, options) {
    res.writeHead(403);
    res.end(`403 Access Denied: ${options.reqPath}`);
};
makeResponse.goodFile = function (res, options) {
    let myFileName = options.reqPathArr.slice().reverse()[0];
    let myFileExtName = myFileName.split('.').reverse()[0].toLowerCase();
    let txtExtNames = ['txt','md','js','css','html'];
    let fileMimeType = 'application/octet-stream';
    // console.log(`myFileName: ${myFileName} | myFileExtName: ${myFileExtName}`);
    if (txtExtNames.indexOf(myFileExtName) !== -1) {
        fileMimeType = 'text/plain';
    };
    fs.readFile(getRealFsPath(options.reqPathArr), function (err, stdout, stderr) {
        if (!err) {
            let myResHeaders = {
                'Content-Type': fileMimeType,
            };
            if (fileMimeType !== 'text/plain') {
                myResHeaders['Content-Disposition'] = `attachment; filename="${encodeURIComponent(myFileName)}"`;
            };
            res.writeHead(200, myResHeaders);
            res.end(stdout);
        } else {
            res.writeHead(404);
            res.end(`404 Not Found: ${options.reqPath}Arr`);
        };
    });
};
makeResponse.goodDir = function (res, options) {
    const getParentWebDir = function (reqPathArr) {
        return '/' + reqPathArr.slice(0).reverse().slice(1).reverse().join('');
    };
    const genShareButtonSmall = function (filedirpath, token) {
        if (validateToken(token, 'A', undefined)) {
            return `<a class="small" target="_blank" href="/.api/shareResource?token=${token}&filedirpath=${encodeURIComponent(filedirpath)}">[Share]</a>`;
        } else {
            return '';
        };
    };
    const renderIndexHtml = function (reqPathArr, token) {
        let listHtml_dirs = '';
        let listHtml_files = '';
        let parentDirHint = '<div>&nbsp;</div>';
        console.log(`777 reqPathArr: ${reqPathArr}`);

        if (reqPathArr[0] === '') {
            // Yes this is root
            console.log('Yes this is root');
            listHtml_files = '';
            listHtml_dirs = Object.keys(DirsDict).map(function (dirName) {
                return `<li>
                    ${genShareButtonSmall(`/${dirName}/`, token)}
                    <a class="normal" href="/${dirName}/?token=${token}">${dirName}/</a>
                </li>`;
            });
        } else {
            listHtml_dirs = getDirSubdirs(getRealFsPath(reqPathArr)).map(function (dirName) {
                return `<li>
                    ${genShareButtonSmall(`/${reqPathArr.join('/')}/${dirName}/`, token)}
                    <a class="normal" href="/${reqPathArr.join('/')}/${dirName}/?token=${token}">${dirName}/</a>
                </li>`;
            }).join('');
            listHtml_files = getDirFiles(getRealFsPath(reqPathArr)).map(function (fileName) {
                return `<li>
                    ${genShareButtonSmall(`/${reqPathArr.join('/')}/${fileName}`, token)}
                    <a class="normal" href="/${reqPathArr.join('/')}/${fileName}?token=${token}">${fileName}</a>
                </li>`;
            }).join('');
            console.log(`6777 length: ${reqPathArr.length}`);
            if (reqPathArr.length === 1) {
                // Now inside a tier-1 directory
                parentDirHint = `<div>Parent: <a class="" href="/?token=${token}">(root)</a></div>`;
            } else {
                // Somewhere deeper
                parentDirHint = `<div>Parent: <a class="" href="${getParentWebDir(reqPathArr)}/?token=${token}">${getParentWebDir(reqPathArr)}</a></div>`;
            };
        };

        return `<html>
            <head>
                <meta charset="utf-8" />
                <title>File Server: /${options.reqPathArr.join('/')}</title>
                <style>
                html { padding: 0px; }
                body {
                    font-family: -apple-system, Helvetica, Arial, sans-serif;
                    font-size: 20px;
                    line-height: 2em;
                    padding: 15px 0 0;
                }
                div.cont {
                    padding: 15px;
                }
                ul, li {
                    display: block;
                }
                ul li a.micro,
                ul li a.small {
                    font-size: 18px;
                    color: #666;
                    margin: 0 10px 0 0;
                }
                ul li a.normal {
                    font-size: 24px;
                    color: #00E;
                }
                a {
                    text-decoration: none;
                }

                </style>
            </head>
            <body>
                <h1>File Server: /${options.reqPathArr.join('/')}</h1>
                ${parentDirHint}
                <!-- h3>Directories</h3 -->
                <ul>${listHtml_dirs}
                <!--/ul-->
                ${ (reqPathArr[0] === '' ? '' : `
                    <!-- h3>Files</h3 -->
                    <!--ul-->${listHtml_files}</ul>
                `) }
            </body>
        </html>`;
    };
    console.log(`8005 options.reqPathArr.length: ${options.reqPathArr.join()}`);
    console.log(options.reqPathArr);
    if (options.reqPathArr[0] === '') {
        console.log(8006);
        res.writeHead(200, {
            'Content-Type': 'text/html',
        });
        res.end(renderIndexHtml(options.reqPathArr, options.parsedParams.token));
    } else {
        console.log(8007);
        fs.readdir(getRealFsPath(options.reqPathArr), function (err, stdout, stderr) {
            if (!err) {
                res.writeHead(200, {
                    'Content-Type': 'text/html',
                });
                res.end(renderIndexHtml(options.reqPathArr, options.parsedParams.token));
            } else {
                res.writeHead(404);
                res.end(`404 Not Found: ${options.reqPathArr}`);
            };
        });
    }

};
// --------------------------------------------
// HTTP server
// --------------------------------------------
const parseSearchParams = function (rawParams) {
    let obj = {};
    rawParams.split('&').map(function (x) {
        let arr = x.split('=');
        obj[arr[0]] = arr[1];
    });
    return obj;
};
const apiEndpoints = {};
apiEndpoints.shareResource = function (res, options) {
    let tokenRequest = newToken('V', decodeURIComponent(options.parsedParams.filedirpath), 24*3600*1000);
    res.writeHead(200, {
        'Content-Type': 'text/html'
    });
    res.end(`<a href="${decodeURIComponent(options.parsedParams.filedirpath)}?token=${tokenRequest}">The temporary public URL is here</a>`);
};
const apiRouter = function (res, options) {
    let apiName = options.reqPath.replace('/.api/', '').replace(/\?.*$/, '');
    console.log(`apiName: ${apiName}`);
    if (apiEndpoints[apiName] && validateToken(options.parsedParams.token, 'A', undefined)) {
        apiEndpoints[apiName](res, options);
    } else {
        makeResponse.bad(res, options);
    };
};
http.createServer(function (req, res) {
    // Parse request
    console.log('\n------------------- New Request -------------------');
    console.log(`req.url: ${req.url}`);
    let reqPath = req.url;
    let parsedParams = {};

    if (req.url.indexOf('?') !== -1) {
        // Search params found
        reqPath = req.url.split('?')[0];
        let rawParams = req.url.split('?')[1];
        parsedParams = parseSearchParams(rawParams);
        // console.log(parsedParams);
    } else {
        return 0;
    };
    let reqPathArr = reqPath.replace(/(^\/|\/$)/g, '').split('/');
    console.log(`reqPathArr: ${reqPathArr}`);
    if (req.url.indexOf('/.api/') === 0) {
        console.log(`Going to API router`);
        apiRouter(res, {
            reqPath: reqPath,
            parsedParams: parsedParams
        });
        return 0;
    };
    let pathType = 'file';
    if (reqPath[reqPath.length - 1] === '/') {
        pathType = 'dir';
    };
    console.log(`233 reqPath: ${reqPath}`);

    // Normal file resource
    if (parsedParams.token) {
        if (validateToken(parsedParams.token, 'V', reqPath)) {
            // Good token, should try the path
            if (pathType === 'file') {
                makeResponse.goodFile(res, {
                    parsedParams: parsedParams,
                    // tokenType: validateToken(parsedParams.token, 'A') ? 'A' : 'V',
                    pathType: pathType,
                    reqPathArr: reqPathArr
                });
            } else {
                console.log(8003, reqPathArr);
                makeResponse.goodDir(res, {
                    parsedParams: parsedParams,
                    // tokenType: validateToken(parsedParams.token, 'A') ? 'A' : 'V',
                    pathType: pathType,
                    reqPathArr: reqPathArr
                });
            };
        } else {
            // Bad token, should say 403
            console.log(`Access denied: ${parsedParams.token}`);
            makeResponse.deny(res, {
                parsedParams: parsedParams,
                pathType: pathType,
                reqPath: reqPath
            });
        };
    } else {
        // Bad token or bad file path, should say 404
        makeResponse.bad(res, {
            parsedParams: parsedParams,
            pathType: pathType,
            reqPath: reqPath
        });
    };
}).listen(1453);
