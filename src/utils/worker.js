const fs = require('fs');

// get directory tree
async function getDirTree(fpath) {
    // recursive function
    async function getTree(fpath) {
        let tree = [];
        let files = await fs.promises.readdir(fpath);
        for (let file of files) {
            let stat = await fs.promises.stat(fpath + '/' + file);
            if (stat.isDirectory()) {
                tree.push({
                    name: file,
                    type: 'directory',
                    children: await getTree(fpath + '/' + file)
                });
            } else {
                tree.push({
                    name: file,
                    type: 'file'
                });
            }
        }
        return tree;
    }
    return await getTree(fpath);
}

function formatTree(tree) {
    let paths = [];
    for (let item of tree) {
        if (item.type == 'directory') {
            for (let child of item.children) {
                paths.push(item.name + '/' + child.name);
            }
        } else {
            paths.push(item.name);
        }
    }
    return paths;
}

async function getSingleDir(fpath) {
    // should only be one directory in the path, if not, choose the first one
    let files = await fs.promises.readdir(fpath);
    for (let file of files) {
        let stat = await fs.promises.stat(fpath + '/' + file)
        if (stat.isDirectory()) {
            return file;
        }
    }
    return null;
}

// wipe directory
async function wipeDir(fpath) {
    // make sure the directory exists
    if (!fs.existsSync(fpath)) {
        fs.mkdirSync(fpath);
    }
    return new Promise((resolve, reject) => {
        // delete all files in the directory, then remake the directory
        fs.rm(fpath, { recursive: true, force: true }, (err) => {
            if (err) {
                reject(err);
            } else {
                fs.mkdir(fpath, (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            }
        });
    });
}

async function readTextFile(fpath) {
    console.log('reading file: ' + fpath);
    return new Promise((resolve, reject) => {
        fs.readFile(fpath, 'utf8', (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        })
    });
}

// export functions
module.exports = {
    getDirTree,
    getSingleDir,
    wipeDir,
    formatTree,
    readTextFile
}
