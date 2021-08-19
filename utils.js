const exec = require('child_process').exec;
const fs = require("fs")
const path = require("path")

/**
 * Look ma, it's cp -R.
 * @param {string} src  The path to the thing to copy.
 * @param {string} dest The path to the new copy.
 */
var copyRecursiveSync = function(src, dest) {
  var exists = fs.existsSync(src);
  var stats = exists && fs.statSync(src);
  var isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    try {
        fs.mkdirSync(dest);
    } catch (e) {};
    fs.readdirSync(src).forEach(function(childItemName) {
      copyRecursiveSync(path.join(src, childItemName),
                        path.join(dest, childItemName));
    });
  } else if (exists) {
    fs.copyFileSync(src, dest);
  }
};


async function execCmdExecutor (cmdStr, maxBuffer = 1024 * 1024 * 10) {
    let p, f;
    exec(cmdStr, { maxBuffer: maxBuffer }, (error, stdout, stderr) => {
        if (error) {
            //console.log(`\n${Date()}: execCmdExecutor failed!: ${cmdStr}: ${error}\n`);
            //throw error;
            //XXX: need to send error alert in a better way
            //console.log(stdout);
            f("err");
            return;
        }
        f(stdout);
    });
    p = new Promise((resolve, reject) => {
        f = (ret) => {
            resolve(ret);
        };
    });
    return p;
}

module.exports = {
    execCmdExecutor,
    copyRecursiveSync
};