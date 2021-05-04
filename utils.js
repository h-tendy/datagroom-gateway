const exec = require('child_process').exec;

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
    execCmdExecutor
};