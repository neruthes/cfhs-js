#!/bin/node

// --------------------------------------------
// Dependencies
// --------------------------------------------
const os = require('os');
const fs = require('fs');
const http = require('http');
const child_process = require('child_process');
const sh = require('child_process').execSync;

// --------------------------------------------
// Arguments
// --------------------------------------------
const VERB = process.argv[2];
const ITNAME = process.argv[3];

// --------------------------------------------
// Early bootloading
// --------------------------------------------
console.log(`Starting instance: ~/.config/cfhs-js/${ITNAME}`);
console.log(`My PID is ${process.pid} (${process.env.USER})`);
fs.writeFileSync(`/tmp/run/cfhs-js.pid/${process.env.USER}/${ITNAME}`, process.pid.toString());
let imgCacheDir = `/tmp/run/cfhs-js.imgcache/${process.env.USER}/${ITNAME}`;
fs.mkdirSync(imgCacheDir, { 'recursive': true });

// --------------------------------------------
// Global variables
// --------------------------------------------
const HOME = os.homedir();
let GlobalConf = {};
let InstanceConfDefault = {
    'Port': '1453',
    'ServerName': 'File Server',
    'UrlPrefix': 'http://127.0.0.1:1453'
};
let InstanceConf = {};
let TokensList = [];
let TokensDict = {};
let DirsDict = {};
const ImgCacheTimeMap = {};
if (fs.existsSync(`${imgCacheDir}/catalog.json`)) {
    try {
        let jsonObj = JSON.parse(fs.readFileSync(`${imgCacheDir}/catalog.json`).toString());
        Object.keys(jsonObj).map(function (jobId) {
            ImgCacheTimeMap[jobId] = jsonObj[jobId];
        });
        console.log(`Found ImgCacheTimeMap cache catalog.`);
        console.log(ImgCacheTimeMap);
    } catch (e) {
    }
};
const ImgCacheJobQueueObj = {};
let ImgThumbnailCreationActiveObjId = undefined;

let isRepeating = false;
let isImageThumbnailCreationBusy = false;

// --------------------------------------------
// Lib functions
// --------------------------------------------
const parseConf = function (txt) {
    let arr = txt.trim().split('\n').filter(x => x[0] !== '#');
    let obj = {};
    arr.map(function (line) {
        let arr2 = line.split('=');
        obj[arr2[0]] = arr2[1];
    });
    return obj;
};
const updateTokensDB = function (txt) {
    let _TokensList = [];
    let _TokensDict = {};
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
        _TokensList.push(tokenItem);
        _TokensDict[tokenItem.Token] = tokenItem;
    });
    TokensList = _TokensList;
    TokensDict = _TokensDict;
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
    fs.writeFileSync(`${HOME}/.config/cfhs-js/${ITNAME}/tokens`, serializeTokens(TokensList));
};
const parseDirs = function (txt) {
    let localDirsDict = {};
    txt.split('\n').filter(x=>x[0]!=='#').map(function (line) {
        if (line.indexOf(':') !== -1) {
            // Has cname declaration
            let lineArr = line.split(':');
            localDirsDict[lineArr[1]] = lineArr[0];
        } else {
            // Use the base name
            let baseName = line.split('/').reverse()[0];
            localDirsDict[baseName] = line;
        };
    });
    return localDirsDict;
};
const readConfAndUpdate = function() {
    let InstanceConf_txt = fs.readFileSync(`${HOME}/.config/cfhs-js/${ITNAME}/conf`).toString().trim();
    InstanceConf = parseConf(InstanceConf_txt);

    // Read TokensDB
    let TokensDB_txt = fs.readFileSync(`${HOME}/.config/cfhs-js/${ITNAME}/tokens`).toString().trim();
    updateTokensDB(TokensDB_txt);

    // Try finding an admin token
    probeAdminToken();

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
};
const probeAdminToken = function () {
    const getFullRootUrl = function (tokenUuid) {
        let prefix = InstanceConf.UrlPrefix || `http://127.0.0.1:${InstanceConf.Port}`;
        let tmpStr = `${prefix}/?token=${tokenUuid}`.replace(/:(80|443)/, '');
        return tmpStr;
    };
    if (TokensList.filter(x=>x.Type === 'A').length === 0) {
        let tokenUuid = newToken('A', '/', 10*365*24*3600*1000);
        isRepeating ? null : console.log(`Added new admin token: ${getFullRootUrl(tokenUuid)}`);
    } else {
        let tokenUuid = TokensList.filter(x => x.Type === 'A')[0].Token;
        isRepeating ? null : console.log(`Found admin token: ${getFullRootUrl(tokenUuid)}`);
    };
};
const validateToken = function (candidateToken, desiredType, attemptingPath) {
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
        if (TokensDict[candidateToken].Type !== 'A') {
            console.log(`validateToken: fail: Not within authorized scope ${candidateToken}`);
            console.log(`attemptingPath: ${attemptingPath}`);
            console.log(`authorizedPath: ${TokensDict[candidateToken].Path}`);
            return false;
        }
    };
    // console.log(`validateToken: success: ${candidateToken}`);
    return true;
};
const getRealFsPath = function (reqPathArr) {
    let arr = reqPathArr.slice(0);
    arr[0] = DirsDict[arr[0]];
    return arr.join('/');
};
const getDirSubdirs = function (source) {
    return fs.readdirSync(source, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .filter(dirent => dirent.name[0] !== '.')
        .map(dirent => dirent.name);
};
const getDirFiles = function (source) {
    return fs.readdirSync(source, { withFileTypes: true })
        .filter(dirent => dirent.isFile())
        .filter(dirent => dirent.name[0] !== '.')
        .map(dirent => dirent.name);
};
const getDirFilesObjList = function (source) {
    return fs.readdirSync(source, { withFileTypes: true })
        .filter(dirent => dirent.isFile())
        .filter(dirent => dirent.name[0] !== '.')
};
const padLeft = function (str, len, pad) {
    if (str.length >= len) {
        return str;
    };
    return (new Array(len-str.length).fill(pad || ' ')).join('') + str;
};
const getFileSizeStr = function (rawFileSize) {
    let level = 0;
    let tmpNum = rawFileSize;
    while (tmpNum > 1024 && level < 3) {
        tmpNum = tmpNum/1024;
        level += 1;
    };
    let betterNum = Math.ceil(tmpNum * 100) / 100;

    return `${padLeft(betterNum.toString(), 7, '&nbsp;')} ${['B','KB','MB','GB'][level]}`;
};
const sha256sum = function (rawStr) {
    return require('crypto').createHmac('sha256', 'Neruthes').update(rawStr).digest("hex")
};
const getImgThumbnailFilePath = function (reqPathArr) {
    let imgFsPath = getRealFsPath(reqPathArr);
    let pathHash = sha256sum(imgFsPath);
    let imgCachePath = `${imgCacheDir}/${pathHash}`;
    return imgCachePath;
};
const makeImgThumbnailCache = function (jobPtr) {
    ImgThumbnailCreationActiveObjId = jobPtr.jobId;
    let reqPathArr = jobPtr.reqPathArr;
    let imgFsPath = getRealFsPath(reqPathArr);
    let imgCachePath = getImgThumbnailFilePath(reqPathArr);
    child_process.exec(`convert '${imgFsPath}' -resize 300 '${imgCachePath}'`, function (err, stdout, stderr) {
        ImgCacheTimeMap[jobPtr.jobId] = Date.now();
        delete ImgCacheJobQueueObj[ImgThumbnailCreationActiveObjId];
        dumpImgCacheTimeMap();
        ImgThumbnailCreationActiveObjId = undefined;
        isImageThumbnailCreationBusy = false;
    });
};
const makeImgThumbnailCreationRequest = function (reqPathArr) {
    let jobId = sha256sum(getRealFsPath(reqPathArr));
    if (ImgCacheJobQueueObj.hasOwnProperty(jobId) && ImgCacheJobQueueObj[jobId].state !== 'done') {
        console.log(`Job already in queue`);
        console.log(ImgCacheJobQueueObj[jobId]);
        return 'err_already_in_queue';
    };
    let obj = {
        'state': 'waiting',
        'jobId': jobId,
        'reqPathArr': reqPathArr
    };
    ImgCacheJobQueueObj[jobId] = obj;
};
const dumpImgCacheTimeMap = function () {
    fs.writeFileSync(`${imgCacheDir}/catalog.json`, JSON.stringify(ImgCacheTimeMap, '\t', 2));
};

// --------------------------------------------
// Initialization
// --------------------------------------------
readConfAndUpdate();

// --------------------------------------------
// Watchdogs
// --------------------------------------------

// Configuration
setInterval(function () {
    // console.log('[INFO] Configuration watchdog invocation');
    readConfAndUpdate();
}, 1000*10);

// Image thumbnail request queue
setInterval(function () {
    if (!isImageThumbnailCreationBusy) {
        let imgCacheJobQueueArr = Object.keys(ImgCacheJobQueueObj).map(kn=>ImgCacheJobQueueObj[kn]).filter(job => job.state === 'waiting');
        if (imgCacheJobQueueArr.length > 0) {
            // Start processing the job
            console.log(`Start processing a thumbnail creation job`);
            isImageThumbnailCreationBusy = true;
            let jobPtr = imgCacheJobQueueArr[0];
            jobPtr.state = 'working';
            makeImgThumbnailCache(jobPtr);
        };
    } else {
        console.log(`isImageThumbnailCreationBusy: ${isImageThumbnailCreationBusy}`);
    };
}, 500);

// --------------------------------------------
// Response categories
// --------------------------------------------
const makeResponse = {};
makeResponse.bad = function (res, options) {
    res.writeHead(404);
    if (options.reqPathArr) {
        res.end(`404 Not Found: /${options.reqPathArr.join('/')}`);
    } else {
        res.end(`404 Not Found: ${options.reqPath}\n${options.msg || ''}`);
    };
};
makeResponse.deny = function (res, options) {
    res.writeHead(403, {
        'Content-Type': 'text/plain'
    });
    res.end(`403 Access Denied: /${options.reqPathArr.join('/')}\n${options.msg || ''}`);
};
makeResponse.goodFile = function (res, options) {
    let isAttachment = true;
    let myFileName = options.reqPathArr.slice().reverse()[0];
    let myFileExtName = myFileName.split('.').reverse()[0].toLowerCase();
    let fileMimeType = 'application/octet-stream';
    let extNamesFor_text = ['txt','md','js','css','html','sh'];
    if (extNamesFor_text.indexOf(myFileExtName) !== -1) {
        fileMimeType = 'text/plain';
        isAttachment = false;
    };
    let mimeTypeMatchTable = {
        'pdf': 'application/pdf',

        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',

        'm4v': 'video/mp4',
        'mp4': 'video/mp4',
        'mov': 'video/quicktime',

        'mp3': 'audio/mpeg',
        'm4a': 'audio/mp4',
        'm4a': 'audio/mp4',
        'wav': 'audio/vnd.wav',
        'ogg': 'audio/ogg',
        'aif': 'audio/x-aiff',
        'aiff': 'audio/x-aiff',
    };
    if (mimeTypeMatchTable.hasOwnProperty(myFileExtName)) {
        fileMimeType = mimeTypeMatchTable[myFileExtName];
        isAttachment = false;
    };
    // Serve thumbnail
    if (options.parsedParams.thumbnail === 'true') {
        let imgTbPath = getImgThumbnailFilePath(options.reqPathArr);
        let shouldRemakeThumbnail = false;
        let imgRawPath = getRealFsPath(options.reqPathArr);
        if (fs.existsSync(imgTbPath)) {
            // Newer than raw image?
            let statRaw = fs.statSync(getRealFsPath(options.reqPathArr));
            let jobId = sha256sum(getRealFsPath(options.reqPathArr));
            if (ImgCacheTimeMap[jobId] && typeof ImgCacheTimeMap[jobId] === 'number' && statRaw.mtimeMs < ImgCacheTimeMap[jobId]) {
                shouldRemakeThumbnail = false;
            } else {
                shouldRemakeThumbnail = true;
            };
        } else {
            shouldRemakeThumbnail = true;
        };
        let imgFileEntity = fs.readFileSync(shouldRemakeThumbnail ? imgRawPath : imgTbPath);
        res.writeHead(200, {
            'Content-Type': fileMimeType
        });
        res.end(imgFileEntity);
        if (shouldRemakeThumbnail) {
            makeImgThumbnailCreationRequest(options.reqPathArr);
        };
    };
    // Normal file
    fs.readFile(getRealFsPath(options.reqPathArr), function (err, stdout, stderr) {
        if (!err) {
            let myResHeaders = {
                'Content-Type': fileMimeType
            };
            let rawFileSize = -33;
            try {
                rawFileSize = fs.statSync(getRealFsPath(options.reqPathArr) + '/' + myFileName).size;
            } catch (e) {
            };
            if (isAttachment) {
                if (rawFileSize !== -33) {
                    myResHeaders['Length'] = rawFileSize;
                }
                myResHeaders['Content-Disposition'] = `attachment; filename="${encodeURIComponent(myFileName)}"`;
            };
            if (rawFileSize > 100 * 1024 * 1024) {
                res.writeHead(200, {});
                res.end(`Sorry. The support for large files (${getFileSizeStr(rawFileSize)}) is not reliable yet.`);
                return 0
            };
            res.writeHead(200, myResHeaders);
            res.end(stdout);
        } else {
            res.writeHead(404);
            res.end(`404 Not Found: ${options.reqPathArr}`);
        };
    });
};
makeResponse.goodDir = function (res, options) {
    const genShareButtonHref = function (filedirpath, token) {
        return `/.api/shareResource?token=${token}&filedirpath=${encodeURIComponent(filedirpath)}`;
    };
    const genShareButtonSmall = function (filedirpath, token) {
        return `<a class="shareButtonSmall" target="_blank" href="${genShareButtonHref(filedirpath, token)}">[Share]</a>`;
    };
    const genShareButtonAlbumCell = function (filedirpath, token) {
        return `<a class="shareButtonAlbumCell" target="_blank" href="${genShareButtonHref(filedirpath, token)}">Share</a>`;
    };
    const genUrlToPath = function (reqPathArr, token) {
        let dirName = reqPathArr.slice(0).reverse()[0];
        let _reqPath = '/' + reqPathArr.join('/');
        if (validateToken(token, 'V', _reqPath)) {
            return `<a class="normal" href="/${reqPathArr.map(x=>encodeURIComponent(x)).join('/')}/?token=${token}">${dirName}</a>`;
        } else {
            return dirName;
        };
    };
    const genParentTree = function (reqPathArr, token) {
        let arr = [];
        if (validateToken(token, 'V', '/')) {
            arr.push( `<a class="normal" href="/?token=${token}">(root)</a>` );
        } else {
            arr.push( `(root)` );
        };
        for (var i = 1; i <= reqPathArr.length; i++) {
            arr.push(genUrlToPath(reqPathArr.slice(0, i), token));
        };
        return arr.join(' / ');
    };

    // Decide indexPageType
    let indexPageType = 'list';
    let dirMetadataFilePath_indexType = getRealFsPath(options.reqPathArr) + '/.cfhs-index-type';
    if (fs.existsSync(dirMetadataFilePath_indexType)) {
        indexPageType = fs.readFileSync(dirMetadataFilePath_indexType).toString().trim();
    };

    // Start rendering
    let indexPageStyle_common = `
    html { padding: 0px; margin: 0px; }
    body {
        font-family: -apple-system, Helvetica, Arial, sans-serif;
        font-size: 20px;
        line-height: 2em;
        padding: 0px; margin: 0px;
    }
    div.cont {
        padding: 18px;
    }
    header {
        padding: 2px;
        margin: 0 0 15px;
    }
    header h1.server-name {
        font-size: 40px;
        font-weight: 800;
    }
    header h2.server-heading {
        font-size: 26px;
        font-weight: 500;
    }
    .parentDirHint {
        font-size: 22px;
    }
    a.normal {
        font-size: 22px;
        color: #00E;
    }
    a {
        text-decoration: none;
    }
    a.shareButtonSmall {
        font-size: 18px;
        color: #666;
        margin: 0 15px 0 0;
    }
    table.main-table {
        margin: 0 0 30px;
    }
    table.main-table,
    table.main-table tbody {
        width: 100%;
        border: none;
    }
    table.main-table tr {
        height: 50px;
    }
    table.main-table tr td,
    table.main-table tr th {
        text-align: left;
        // padding-left: 10px;
        border-bottom: 1px solid #DDD;
    }
    table.main-table tr:nth-child(odd) {
        // background: #F5F5F5;
    }
    table.main-table tr td:nth-child(1),
    table.main-table tr th:nth-child(1) {
        min-width: calc(58% - 40px);
        padding-right: 10px;
    }
    table.main-table tr td:nth-child(2),
    table.main-table tr th:nth-child(2) {
        text-align: right
        max-width: 100px;
    }
    `;
    let indexPageStyle = {};
    indexPageStyle.album = `
    .album-cell {
        background: #EEE;
        position: relative;
        top: 0px;
        left: 0px;
        display: inline-block;
        min-width: 100px;
        max-width: 500px;
        height: 240px;
        margin: 0 10px 10px 0;
    }
    .album-cell a.cell-link {
        display: block;
        width: auto;
        height: 100%;
    }
    .album-cell a.cell-link img {
        display: block;
        width: auto;
        height: 100%;
        // max-width: 200px;
    }
    .album-cell a.shareButtonAlbumCell {
        display: none;
    }
    .album-cell:hover a.shareButtonAlbumCell {
        font-size: 18px;
        line-height: 24px;
        color: #FFF;
        background: #000;
        border-radius: 5px;
        display: block;
        position: absolute;
        top: 8px;
        left: 8px;
        width: auto;
        padding: 5px 8px;
    }
    `;
    indexPageStyle.list = `
    `;
    let htmlHead = `<head>
        <meta charset="utf-8" />
        <title>${InstanceConf.ServerName}: /${options.reqPathArr.join('/')}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style data-index-type="album">
        </style>
        <style data-index-type="list">
        ${indexPageStyle_common}
        ${indexPageStyle[indexPageType]}
        </style>
    </head>`;
    let htmlPageHeader = `<header>
        <h1 class="server-name">${ InstanceConf.ServerName || 'File Server' }</h1>
        <h2 class="server-heading">${ InstanceConf.ServerHeading || '' }</h2>
        <nav class="parentDirHint">
            Location: ${genParentTree(options.reqPathArr, options.parsedParams.token)}
        </nav>
    </header>`;
    let renderIndexHtml = {};
    renderIndexHtml.album = function (reqPathArr, token) {
        const isAdminToken = validateToken(token, 'A', undefined);
        let listHtml_dirs = getDirSubdirs(getRealFsPath(reqPathArr)).map(function (dirName) {
            return `<tr>
                <td class="">
                    ${isAdminToken ? genShareButtonSmall(`/${reqPathArr.map(x=>encodeURIComponent(x)).join('/')}/${encodeURIComponent(dirName)}/`, token) : ''}
                    <a class="normal" href="/${reqPathArr.map(x=>encodeURIComponent(x)).join('/')}/${encodeURIComponent(dirName)}/?token=${token}">${dirName}/</a>
                </td>
            </tr>`;
        });

        let albumCells = getDirFiles(getRealFsPath(reqPathArr)).map(function (fileName) {
            return `<div class="album-cell">
                <a class="cell-link" href="/${reqPathArr.map(x=>encodeURIComponent(x)).join('/')}/${encodeURIComponent(fileName)}?token=${token}">
                    <img src="/${reqPathArr.map(x=>encodeURIComponent(x)).join('/')}/${encodeURIComponent(fileName)}?token=${token}&thumbnail=true">
                    ${genShareButtonAlbumCell(`/${reqPathArr.map(x=>encodeURIComponent(x)).join('/')}/${encodeURIComponent(fileName)}`, token)}
                </a>
            </div>`;
        }).join('');

        return `<html>
            ${htmlHead}
            <body data-index-type="${indexPageType}">
                <div class="cont">
                    ${htmlPageHeader}
                    ${(listHtml_dirs.length === 0 ? '' : (function () {
                        return `<table class="main-table">
                            <tbody>
                                <tr>
                                    <th>Subdirectories</th>
                                </tr>
                                ${listHtml_dirs.join('')}
                            </tbody>
                        </table>`
                    })())}
                    <div class="album">
                    ${albumCells}
                    </div>
                </div>
                <script>
                // let albumCells = document.querySelectorAll('.album-cell img[data-prng-id]');
                // albumCells.forEach(function (imgNode) {
                //     return 0;
                // });
                </script>
            </body>
        </html>`;
    };
    renderIndexHtml.list = function (reqPathArr, token) {
        const isAdminToken = validateToken(token, 'A', undefined);
        let listHtml_dirs = [];
        let listHtml_files = [];
        let parentDirHint = '';

        if (reqPathArr[0] === '') {
            // Yes this is root
            listHtml_files = [];
            listHtml_dirs_1 = [`<tr><td>${isAdminToken ? genShareButtonSmall(`/`, token) : ''} (root)</td><td></td></tr>`];
            listHtml_dirs_2 = Object.keys(DirsDict).map(function (dirName) {
                return `<tr>
                    <td>
                        ${isAdminToken ? genShareButtonSmall(`/${encodeURIComponent(dirName)}`, token) : ''}
                        <a class="normal" href="/${dirName}/?token=${token}">${dirName}/</a>
                    </td>
                    <td>
                    </td>
                </tr>`;
            });
            listHtml_dirs = listHtml_dirs_1.concat(listHtml_dirs_2);
        } else {
            // This is not root
            listHtml_dirs = getDirSubdirs(getRealFsPath(reqPathArr)).map(function (dirName) {
                return `<tr>
                    <td class="">
                        ${isAdminToken ? genShareButtonSmall(`/${reqPathArr.map(x=>encodeURIComponent(x)).join('/')}/${dirName}`, token) : ''}
                        <a class="normal" href="/${reqPathArr.map(x=>encodeURIComponent(x)).join('/')}/${encodeURIComponent(dirName)}/?token=${token}">${dirName}/</a>
                    </td>
                    <td class="">
                    </td>
                </tr>`;
            });
            listHtml_files = getDirFiles(getRealFsPath(reqPathArr)).map(function (fileName) {
                let rawFileSize = fs.statSync(getRealFsPath(reqPathArr) + '/' + fileName).size;
                return `<tr>
                    <td class="">
                        ${isAdminToken ? genShareButtonSmall(`/${reqPathArr.map(x=>encodeURIComponent(x)).join('/')}/${fileName}`, token) : ''}
                        <a class="normal" href="/${reqPathArr.map(x=>encodeURIComponent(x)).join('/')}/${encodeURIComponent(fileName)}?token=${token}">${fileName}</a>
                    </td>
                    <td class="">
                        <small style="font-family: monospace;">${getFileSizeStr(rawFileSize)}</small>
                    </td>
                </tr>`;
            });
        };

        return `<html>
            ${htmlHead}
            <body data-index-type="${indexPageType}">
                <div class="cont">
                    ${htmlPageHeader}
                    <table class="main-table">
                        <tbody>
                            <tr>
                                <th>File Name</th>
                                <th>Size</th>
                            </tr>
                            ${(listHtml_files.length + listHtml_dirs.length === 0) ? 'This directory is empty' : (
                                listHtml_dirs.join('') + listHtml_files.join('')
                            )}
                        </tbody>
                    </table>
                </div>
            </body>
        </html>`;
    };
    if (options.reqPathArr[0] === '') {
        res.writeHead(200, {
            'Content-Type': 'text/html',
        });
        res.end(renderIndexHtml[indexPageType](options.reqPathArr, options.parsedParams.token));
    } else {
        fs.readdir(getRealFsPath(options.reqPathArr), function (err, stdout, stderr) {
            if (!err) {
                res.writeHead(200, {
                    'Content-Type': 'text/html',
                });
                res.end(renderIndexHtml[indexPageType](options.reqPathArr, options.parsedParams.token));
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
    let targetUrl = decodeURIComponent(options.parsedParams.filedirpath);
    if (targetUrl.split('').reverse()[0] === '/') {
        // Is directory
        // targetUrl = '/';
    } else {
    };
    res.writeHead(200, {
        'Content-Type': 'text/html'
    });
    res.end(`<a href="${targetUrl}?token=${tokenRequest}">The temporary public URL is here</a>`);
};
const apiRouter = function (res, options) {
    let apiName = options.reqPath.replace('/.api/', '').replace(/\?.*$/, '');
    console.log(`Invoking API endpoint: ${apiName}`);
    if (apiEndpoints[apiName] && validateToken(options.parsedParams.token, 'A', undefined)) {
        apiEndpoints[apiName](res, options);
    } else {
        let _options = Object.keys(options).map(x=>options[x]);
        _options.msg = `Bad API query`;
        makeResponse.bad(res, _options);
    };
};
http.createServer(function (req, res) {
    // Parse request
    console.log(`****New Request: ${req.url}`);
    let reqPath = req.url;
    let parsedParams = {};

    if (req.url.indexOf('?') !== -1) {
        // Search params found
        reqPath = req.url.split('?')[0];
        let rawParams = req.url.split('?')[1];
        parsedParams = parseSearchParams(rawParams);
    } else {
        res.writeHead(400);
        res.end('Bad request: Too few search parameters.');
        return 0;
    };
    let reqPathArr = reqPath.replace(/(^\/|\/$)/g, '').split('/');
    let pathType = 'file';
    if (reqPath[reqPath.length - 1] === '/') {
        pathType = 'dir';
    };
    if (req.url.length < 2) {
        makeResponse.deny(res, {
            parsedParams: parsedParams,
            pathType: pathType,
            reqPathArr: reqPathArr,
            reqPath: reqPath,
            msg: 'URL is too short'
        });
        return 0;
    };

    // Send to API router?
    if (req.url.indexOf('/.api/') === 0) {
        apiRouter(res, {
            reqPath: reqPath,
            parsedParams: parsedParams
        });
        return 0;
    };

    // Normal file resource
    reqPathArr = reqPathArr.map(x => decodeURIComponent(x));
    if (parsedParams.token) {
        if (validateToken(parsedParams.token, 'V', reqPath)) {
            // Good token, should try the path
            // Unless the any in the chain is hidden
            if (reqPath !== '/' && reqPathArr.filter(x => x[0] === '.').length !== 0) {
                makeResponse.deny(res, {
                    parsedParams: parsedParams,
                    pathType: pathType,
                    reqPathArr: reqPathArr,
                    msg: 'This is a hidden file.'
                });
                return 0;
            };
            if (pathType === 'file') {
                makeResponse.goodFile(res, {
                    parsedParams: parsedParams,
                    pathType: pathType,
                    reqPathArr: reqPathArr
                });
            } else {
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
                reqPathArr: reqPathArr,
                reqPath: reqPath
            });
        };
    } else {
        // Bad token or bad file path, should say 404
        makeResponse.bad(res, {
            parsedParams: parsedParams,
            pathType: pathType,
            reqPath: reqPath,
            msg: 'Bad token or bad file path'
        });
    };
}).listen(InstanceConf.Port);

isRepeating = true;
