const express = require('express');
const bodyParser = require('body-parser');
const passport = require('passport');
const path = require('path');
const compression = require('compression');
const LdapStrategy = require('passport-ldapauth').Strategy;
const cookieParser = require('cookie-parser');
const session = require('express-session');
const cors = require('cors');
const jwt = require('jsonwebtoken')
const DbAbstraction = require('./dbAbstraction');
const ExcelUtils = require('./excelUtils');
const Utils = require('./utils');

const reactuiDir = path.resolve(__dirname, '../datagroom-ui/build');
const config = {
    express: {
        port: process.env.PORT || 8887,
    },
    jwtSecret: "_JWT_SECRET_"
};

// Active directory functionality
let disableAD = false; 

if (process.argv.length >= 2) {
    for (let i = 2; i < process.argv.length; i++) {
        let argkv = process.argv[i].split('=');
        if(argkv[0] == 'disableAD' && argkv[1] == "true") {
            disableAD = true;
        }
    }
}



const app = express();
var httpServer = require('http').createServer(app);
var io = require('socket.io')(httpServer, { pingTimeout: 60000 });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, D-Hive-User");
    next();
}); 
app.use(bodyParser.json());
app.use(compression());
app.use(express.static(reactuiDir));

app.use(cors());
app.use(cookieParser());

if (!disableAD) {
    let ldapOpts = require('./ldapSettings');
    passport.use('ldap-login', new LdapStrategy(ldapOpts, function (user, done) {
        done(null, user);
    }));
}

app.use(passport.initialize());
app.use(passport.session());
app.use(session({
    secret: 'Super Secret',
    resave: false,
    saveUninitialized: true,
    cookie: { httpOnly: true, maxAge: 2419200000 } /// maxAge in milliseconds
}));

Utils.execCmdExecutor('mkdir uploads');

const fileUpload = require('./routes/upload');
app.use('/upload', fileUpload);
const dsReadApi = require('./routes/dsReadApi');
const { unlock } = require('./routes/upload');
app.use('/ds', dsReadApi);
const csvUpload = require('./routes/uploadCsv');
app.use('/uploadCsv', csvUpload);

Utils.execCmdExecutor('mkdir attachments');
const attachmentsDir = path.resolve(__dirname, './attachments');
app.use('/attachments', express.static(attachmentsDir));
const uploadAttachments = require('./routes/uploadAttachments');
app.use('/uploadAttachments', uploadAttachments);

app.route('/login').post(loginAuthenticateForReact);
    
app.all('*', (req, res, next) => {
    res.sendFile('./index.html', {
        root: reactuiDir
    });
});

// Locks logic, move to separate file
var locks = {}; 
var clientLocks = {};
function dgLock (lockReq, clientId) {
    if (!locks[lockReq.dsName]) {
        locks[lockReq.dsName] = {};
    }
    let dsLocks = locks[lockReq.dsName];
    if (!dsLocks[lockReq._id]) {
        dsLocks[lockReq._id] = {};
    }
    let docLocks = dsLocks[lockReq._id];
    if (!docLocks[lockReq.field]) {
        let prevLockReq = null;
        if (clientLocks[clientId]) {
            // previous lock
            prevLockReq = clientLocks[clientId];
            dgUnlock(prevLockReq, clientId);
            // dgUnlock might remove this object if there weren't any other locks
            // on this same document. So, reinitialize an object for this document. 
            if (!dsLocks[lockReq._id]) {
                dsLocks[lockReq._id] = {};
                docLocks = dsLocks[lockReq._id];
            }
        }
        clientLocks[clientId] = lockReq;
        docLocks[lockReq.field] = clientId;
        return {status: true, unlocked: prevLockReq};
    } else {
        let prevLockReq = null;
        if (clientLocks[clientId]) {
            if (JSON.stringify(clientLocks[clientId]) !== JSON.stringify(lockReq)) {
                // previous lock
                prevLockReq = clientLocks[clientId];
                console.log("Previous lock doesn't match, releasing lock: ", prevLockReq);
                delete clientLocks[clientId];
                dgUnlock(prevLockReq, clientId);
            } else {
                return {status: true, unlocked: null};
            }
        }
        return {status: false, unlocked: prevLockReq};
    }
}

function dgUnlock(unlockReq, clientId) {
    try {
        if (locks[unlockReq.dsName][unlockReq._id][unlockReq.field] === clientId) {
            delete locks[unlockReq.dsName][unlockReq._id][unlockReq.field];
            if (! Object.keys(locks[unlockReq.dsName][unlockReq._id]).length) 
                delete locks[unlockReq.dsName][unlockReq._id];
            delete clientLocks[clientId];
            //console.log("Returning true in dgUnLock: 1");
            return {status: true}
        } 
    } catch (e) { console.log("Exception in dgUnlock", unlockReq)}

    if (unlockReq.newVal) { // XXX: Should it have more stringent checks here?
        //console.log("Returning true in dgUnlock: 2");
        return {status: true}
    }
    //console.log("Returning false in dgUnlock.")
    return {status: false}
}

function dgUnlockForClient (clientId) {
    try {
        if (clientLocks[clientId]) {
            let prevLockReq = clientLocks[clientId];
            dgUnlock(prevLockReq, clientId);               
            return {status: true, unlocked: prevLockReq}
        }
    } catch (e) {}
    return {status: false, unlocked: null}
}



(() => {
    /*
    const srv = app.listen(config.express.port, () => {
        console.log('Listening on port ' + config.express.port);
        srv.timeout = 60 * 60 * 1000;
    })
    */
    httpServer.listen(config.express.port);
    console.log('Listening on port : ', config.express.port);
    io.on('connection', (client) => {
        console.log(`${Date()}: Client connected...`, client.id);
        client.on('Hello', function (helloObj) {
            console.log(`${Date()}: Hello from :`, helloObj);
            client.emit('Hello', { server: "Hi there!" });
        });
        client.on('lockReq', (lockReq) => {
            console.log(`${Date()}: lockReq: `, lockReq);
            let {status, unlocked} = dgLock(lockReq, client.id);
            if (status) {
                client.broadcast.emit('locked', lockReq);
            }
            if (unlocked) {
                client.broadcast.emit('unlocked', unlocked);
            }
            let dsLocks = locks[lockReq.dsName];
            console.log('active locks after lockReq:', JSON.stringify(dsLocks));
    
        });
        client.on('unlockReq', (unlockReq) => {
            console.log(`${Date()}: unlockReq: `, unlockReq);
            let {status} = dgUnlock(unlockReq, client.id);
            if (status) {
                client.broadcast.emit('unlocked', unlockReq);
                //console.log("Emitted this unlock request.");
            } else {
                ; //console.log("Not emitting this unlock request. ")
            }
            let dsLocks = locks[unlockReq.dsName];
            console.log('active locks after unlockReq:', JSON.stringify(dsLocks));
        });
        client.on('getActiveLocks', (dsName) => {
            console.log(`${Date()}: getActiveLocks: `, dsName);
            let dsLocks = locks[dsName];
            if (!dsLocks) dsLocks = {};
            console.log('Active Locks: ', dsLocks);
            client.emit('activeLocks', JSON.stringify(dsLocks));
        });
        client.on('disconnect', (mySocket) => {
            console.log(`${Date()}: disconnect: `, client.id);
            let {status, unlocked} = dgUnlockForClient(client.id);
            if (status) {
                client.broadcast.emit('unlocked', unlocked);
            } // else, it is a stale 'unlock' !
        });

    })
})();


function loginAuthenticateForReact(req, res, next) {
    req.session.user = req.body.username;
    let pageToLand = req.query.page;
    console.log("Login Authenticate: ", req.session.user, pageToLand ? pageToLand : '');
    let reqObj = {};
    reqObj.time = Date();
    reqObj.user = req.session.user;

    if (reqObj.user=='guest' && req.body.password == 'guest') {
        let retUser = {
            user: "guest",
            token: jwt.sign({ user: reqObj.user },config.jwtSecret)
        };
        res.send({ ok: true, user: JSON.stringify(retUser)});       
    } else {
        if(disableAD){
            let errMessage = `Only guest Login allowed!`;
            return res.send(errMessage);
        }
        passport.authenticate('ldap-login', { session: true }, function (err, user, info) {
            if (err) {
                reqObj.req = "Login Failed";
                return next(err); // will generate a 500 error
            }
            // Generate a JSON response reflecting authentication status
            if (!user) {
                let errMessage = `Authentication Failed: ${info.message}`;
                reqObj.req = "Login Failed";
                return res.send(errMessage);
            }
            if (user.thumbnailPhoto) {
                req.session.userphoto = 'data:image/jpeg;base64,' + Buffer.from(user.thumbnailPhoto).toString('base64');
            }
            let retUser = {
                user: req.session.user,
                userphoto: req.session.userphoto,
                token: jwt.sign({ user},config.jwtSecret)
            };
            reqObj.req = "Login Successfull";
            console.log(req.session.user, ' logged in successfully');
            res.send({ ok: true, user: JSON.stringify(retUser) });
        })(req, res, next);
    }
}

let dbAbstraction = new DbAbstraction();
dbAbstraction.hello();


//ExcelUtils.exportDataFromDbIntoXlsx('myDb2', 'default', 'jhanu', 'export.xlsx');