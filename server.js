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
const PrepAttachments = require('./prepAttachments');
let fs = require('fs');
const dotenv = require('dotenv')
const Jira = require('./jira')

dotenv.config({ path: './.env' })

const reactuiDir = path.resolve(__dirname, '../datagroom-ui/build');
const config = {
    express: {
        port: process.env.PORT || 8887,
    },
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
var httpServer, io;
try {
    const dirPath = path.join(__dirname, '/ssl');
    let options = {
        key: fs.readFileSync(dirPath + '/datagroom.key'),
        cert: fs.readFileSync(dirPath + '/datagroom.pem')
    };
    let ca = "";
    try {
        ca = fs.readFileSync(dirPath + '/ca.pem')
    } catch (e) {}
    if (ca) options.ca = ca;

    httpServer = require('https').createServer(options, app);
    io = require('socket.io')(httpServer, { pingTimeout: 60000 });
    httpServer.listen(443);
    console.log('https server listening on port : 443');
} catch (e) {
    console.log("Trouble with cert reading: ", e);
    httpServer = require('http').createServer(app);
    io = require('socket.io')(httpServer, { pingTimeout: 60000 });
    httpServer.listen(config.express.port);
    console.log('http server listening on port : ', config.express.port);    
}
httpServer.timeout = 60 * 60 * 1000;

app.use(bodyParser.urlencoded({ extended: true }));

app.use(bodyParser.json());
app.use(compression());
app.use(express.static(reactuiDir));

app.use(cors({
    origin: true,
    allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "D-Hive-User", "authorization", "user", "User", "Authorization", "Accept-Language", "Content-Language", "access-control-allow-origin"],
    optionsSuccessStatus: 204,
    credentials: true,
}));

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
    cookie: { httpOnly: true, maxAge: 2419200000, secure: true } /// maxAge in milliseconds
}));

Utils.execCmdExecutor('mkdir uploads');

app.route('/login').post(loginAuthenticateForReact);
app.route('/sessionCheck').get(sessionCheck);
app.route('/logout').get(logout);

// Define a middleware function to authenticate request
const authenticate = (req, res, next) => {
    console.log("Url called: ", req.baseUrl)

    const token = req.cookies.jwt;
    if (!token) {
        // If jwt token is not available kick in the basic authentication
        console.log("No jwt token in cookie. Will forward for basic authentication");
        basicAuth(req, res, next);
    } else {
        try {
            const decoded = jwt.verify(token, Utils.jwtSecret);
            req.user = decoded.user;
            next();
        } catch (err) {
            console.log("Error in authenticate middleware: " + err.message)
            res.cookie('originalUrl', req.baseUrl, { httpOnly: true, path: '/', secure: true, });
            res.redirect('/login');
            return;
        }
    }
};

// Basic auth will kick in if someone make an api request without cookie token and just the username and pwd
const basicAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        let request = req.body;
        let dsName = request.dsName;
        console.log(`AuthHeader not found in request while pushing to ${dsName}. Redirecting to the login page.`);
        res.cookie('originalUrl', req.baseUrl, { httpOnly: true, path: '/', secure: true, });
        res.redirect('/login');
        return;
    }

    const [scheme, encodedCredentials] = authHeader.split(' ');

    if (scheme.toLowerCase() !== 'basic') {
        console.log('Invalid authentication scheme: ' + scheme);
        res.status(401).send('Invalid authentication scheme');
        return;
    }

    const credentials = Buffer.from(encodedCredentials, 'base64').toString();
    const [username, password] = credentials.split(':');

    if (username === 'guest' && password === 'guest') {
        let jwtToken = jwt.sign({ user: username }, Utils.jwtSecret)
        req.cookies.jwt = jwtToken;
        next();
    } else {
        res.status(401).send('Invalid username or password');
    }
};

// Attach the authentication middleware to all routes except /login
app.use(/^(?!\/login).*$/, authenticate);

const fileUpload = require('./routes/upload');
app.use('/upload', fileUpload);
const dsReadApi = require('./routes/dsReadApi');
const { unlock, options } = require('./routes/upload');
app.use('/ds', dsReadApi);
const csvUpload = require('./routes/uploadCsv');
app.use('/uploadCsv', csvUpload);

Utils.execCmdExecutor('mkdir attachments');
const attachmentsDir = path.resolve(__dirname, './attachments');
app.use('/attachments', express.static(attachmentsDir));
const uploadAttachments = require('./routes/uploadAttachments');
app.use('/uploadAttachments', uploadAttachments);

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
    io.on('connection', (client) => {
        console.log(`${Date()}: Client connected...`, client.id);
        if (!isAuthorized(client)) return;
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
            client.removeAllListeners();
            client.disconnect(true);
        });

    })
})();

(async function () {
    await Jira.createFilteredProjectsMetaData()
})()

function isAuthorized(client) {
    let clientCookie = client && client.handshake && client.handshake.headers && client.handshake.headers.cookie;
    console.log(`${Date()}: Client connected cookie...`, clientCookie);
    if (!clientCookie) {
        console.log("No client cookie found");
        client.emit('exception', 'Authentication failed. Reload the page or login again.');
        client.disconnect(true);
        return false;
    }
    let clientCookieArray = clientCookie.split(';');
    let requiredClientCookieArray = clientCookieArray.filter((cookie) => cookie.trim().startsWith("jwt="));
    if (requiredClientCookieArray.length != 1) {
        console.log("No jwt cookie found.")
        client.emit('exception', 'Authentication failed. Reload the page or login again.');
        client.disconnect(true);
        return false;
    }
    // Extract the jwt token from the cookie
    let token = requiredClientCookieArray[0].split("=")[1];
    // Verify that the token is valid
    try {
        const decoded = jwt.verify(token, Utils.jwtSecret);
        console.log("Token is valid");
    } catch (err) {
        console.log("Error in verifying authentication in socket connection: " + err.message)
        client.emit('exception', 'Authentication failed. Reload the page or login again.');
        client.disconnect(true);
        return false;
    }
    return true;
}

function loginAuthenticateForReact(req, res, next) {
    req.session.user = req.body.username;
    let pageToLand = req.query.page;
    console.log("Login Authenticate: ", req.session.user, pageToLand ? pageToLand : '');
    let reqObj = {};
    reqObj.time = Date();
    reqObj.user = req.session.user;
    let redirectUrl = req.cookies.originalUrl

    if (reqObj.user=='guest' && req.body.password == 'guest') {
        let jwtToken = jwt.sign({ user: reqObj.user }, Utils.jwtSecret)
        let retUser = {
            user: "guest",
            token: jwtToken
        };
        res.cookie('jwt', jwtToken, { httpOnly: true, path: '/', secure: true, });
        res.clearCookie('originalUrl');
        res.send({ ok: true, user: JSON.stringify(retUser), redirectUrl: redirectUrl });
    } else if (reqObj.user == 'hkumar' && req.body.password == 'hkumar') {
        let jwtToken = jwt.sign({ user: reqObj.user }, Utils.jwtSecret)
        let retUser = {
            user: "hkumar",
            token: jwtToken
        };
        res.cookie('jwt', jwtToken, { httpOnly: true, path: '/', secure: true, });
        res.clearCookie('originalUrl');
        res.send({ ok: true, user: JSON.stringify(retUser), redirectUrl: redirectUrl });
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
            let jwtToken = jwt.sign({ user: req.session.user }, Utils.jwtSecret)
            let retUser = {
                user: req.session.user,
                userphoto: req.session.userphoto,
                token: jwtToken
            };
            reqObj.req = "Login Successfull";
            console.log(req.session.user, ' logged in successfully');
            res.cookie('jwt', jwtToken, { httpOnly: true, path: '/', secure: true, });
            res.clearCookie('originalUrl');
            res.send({ ok: true, user: JSON.stringify(retUser), redirectUrl: redirectUrl });
        })(req, res, next);
    }
}

function logout(req, res, next) {
    res.clearCookie('jwt');
    res.send({ ok: true, msg: "Logged out Successfully" });
}

function sessionCheck(req, res, next) {
    const token = req.cookies.jwt;
    if (!token) {
        return res.status(401).json({ message: 'Token missing or invalid' });
    }
    try {
        const decoded = jwt.verify(token, Utils.jwtSecret);
        res.status(200).json({})
    } catch (err) {
        console.log("session check error: " + err.message)
        return res.status(401).json({ message: 'Invalid token' });
    }
};

let dbAbstraction = new DbAbstraction();
dbAbstraction.hello();

//setTimeout(dbAbstraction.destroy, 5000);

PrepAttachments.refreshAttachmentsIntoDb();

//ExcelUtils.exportDataFromDbIntoXlsx('myDb2', 'default', 'jhanu', 'export.xlsx');