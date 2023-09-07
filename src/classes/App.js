const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const rfs = require('rotating-file-stream');
const logger = require('morgan');
const multer = require('multer');
const sessions = require('express-session');
require('dotenv').config();
const { getDirTree, formatTree, readTextFile } = require('../utils/worker');

let accessLogStream = rfs.createStream('access.log', {
    interval: '1d', // rotate daily
    size: '20M', // rotate when file size exceeds 20 MegaBytes
    compress: "gzip", // compress rotated files
    path: path.join(__dirname, '../..', 'logs')
})

// function for multer
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        let user = req.session.user;
        cb(null, path.join(process.cwd(), 'uploads', user));
    },
    filename: function(req, file, cb) {
        // get user
        let user = req.session.user;
        
        // create folder structure
        // search for last occurence of '/'
        let lastSlash = file.originalname.lastIndexOf('/');
        let folder = path.join(process.cwd(), 'uploads', user, file.originalname.substring(0, lastSlash));
        // console.log(folder)
        
        fsp.mkdir(folder, { recursive: true }).then(() => {
            cb(null, file.originalname);
        }).catch(err => {
            cb(err);
        });
    }
});

const uploadHandler = multer({
    preservePath: true,
    storage: storage,
    limits: {
        fileSize: 1024 * 1024 * 500 // 500MB
    }
});

async function authGuard(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        // check if post request
        if (req.method == 'POST') {
            return res.status(401).json({
                message: 'Unauthorized',
                success: false
            });
        }
        res.redirect('/');
    }
}

async function authGuardAdmin(req, res, next) {
    if (req.session.admin) {
        next();
    } else {
        // check if post request
        if (req.method == 'POST') {
            return res.status(401).json({
                message: 'Unauthorized',
                success: false
            });
        }
        res.redirect('/');
    }
}

class App {
    io;
    server;
    constructor() {
        this.app = express();
        this.server = require('http').createServer(this.app);
        this.app.engine('e', require('ejs').renderFile);
        this.app.set('view engine', 'ejs');
        this.app.set('views', path.join(__dirname, '..', 'views'));
        this.app.use(cors());
        this.app.use(cookieParser());
        this.app.use(logger('[:date[iso]] :remote-addr ":referrer" ":user-agent" :method :url :status :res[content-length] - :response-time ms', { stream: accessLogStream }));
        this.app.use(logger(' >> :method :url :status :res[content-length] - :response-time ms'));
        this.app.use(express.json());
        this.app.use(express.urlencoded({
            extended: true
        }));
        this.app.use(sessions({
            secret: process.env.SESSION_SECRET,
            resave: false,
            saveUninitialized: true,
            cookie: {
                maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
            }
        }));
        this.app.use('/public', express.static(path.join(__dirname, '..', 'public')));
    }

    async registerRoutes() {

        this.app.get('/', async function (req, res) {	
            res.render('index.ejs');
        });

        this.app.get('/panel', authGuard, async function (req, res) {
            res.render('panel.ejs');
        });

        this.app.get('/list', authGuardAdmin, async function (req, res) {
            let user = req.session.user;
            let tree = formatTree(await getDirTree(path.join(process.cwd(), 'uploads')));
            res.status(200).json({
                message: 'OK',
                success: true,
                tree: tree
            });
        });

        this.app.get('/admin', authGuardAdmin, async function (req, res) {
            res.render('admin.ejs');
        });

        // login
        this.app.post('/login', async function (req, res) {
            // check user and password
            if (!req.body.username) {
                return res.status(400).json({
                    message: 'Missing username',
                    success: false
                });
            }
            // search for user in array
            if (process.env.ADMIN == req.body.username) {
                // admin login
                req.session.user = req.body.username;
                req.session.admin = true;
                return res.status(200).json({
                    message: 'Login successful',
                    success: true
                });
            } else {
                let user = req.body.username.toLowerCase();
                // replace spaces with _
                user = user.replace(/\s/g, '_');
                req.session.user = user;
                return res.status(200).json({
                    message: 'Login successful',
                    success: true
                });
            }
        });

        // upload
        // this.app.post('/upload', authGuard, async function (req, res) {
        //     // check if submission end time is reached
        //     const endTime = 1694317500000;
        //     if (Date.now() > endTime) {
        //         req.setTimeout(1);
        //         return res.status(400).json({
        //             message: 'Submission time has ended',
        //             success: false
        //         });
        //     }
        //     req.setTimeout(1000 * 60); // 1 minute
        //     // auth check
        //     // clear old files
        //     let user = req.session.user;
        //     // await wipeDir(path.join(process.cwd(), 'uploads', user));

        //     const upload = multer({
        //         preservePath: true,
        //         storage: storage,
        //         limits: {
        //             fileSize: 1024 * 1024 * 500 // 500MB
        //         }
        //     }).array('files', 100); // 100 files max at a time
        //     await upload(req, res, async function(err) {
        //         if (err) {
        //             // console.log(err)
        //             return res.status(400).json({
        //                 message: err.message,
        //                 success: false
        //             });
        //         }
        //     });

        //     // success upload
        //     res.status(200).json({
        //         message: 'Upload successful',
        //         success: true
        //     });
        // });

        // upload but use multi-part form data with multer
        this.app.post('/upload', authGuard, uploadHandler.any(), async function (req, res) {
            // check if submission end time is reached
            const endTime = 1694317500000;
            if (Date.now() > endTime) {
                req.setTimeout(1);
                return res.status(400).json({
                    message: 'Submission time has ended',
                    success: false
                });
            }
            req.setTimeout(1000 * 60); // 1 minute
            // auth check
            // clear old files
            let user = req.session.user;
            // await wipeDir(path.join(process.cwd(), 'uploads', user));

            // success upload
            res.status(200).json({
                message: 'Upload successful',
                success: true
            });

        });

        this.app.get('/link', authGuard, async function (req, res) {
            let link = req.query.u;
            if (!link) {
                return res.status(400).json({
                    message: 'Missing link',
                    success: false
                });
            }
            const endTime = 1694317500000;
            if (Date.now() > endTime) {
                req.setTimeout(1);
                return res.status(400).json({
                    message: 'Submission time has ended',
                    success: false
                });
            }
            // write link to file
            let user = req.session.user;
            let fpath = path.join(process.cwd(), 'uploads', user, 'alinks.txt');
            // create the folders if they don't exist
            if (!fs.existsSync(path.join(process.cwd(), 'uploads', user))) {
                fs.mkdirSync(path.join(process.cwd(), 'uploads', user));
            }
            // append to file
            fs.appendFileSync(fpath, link + '\n');
            res.status(200).json({
                message: 'Link saved',
                success: true
            });
        });

        this.app.get('/read', authGuardAdmin, async function (req, res) {
            let reqpath = req.query.target;
            reqpath = decodeURIComponent(reqpath);
            let fpath = path.join(process.cwd(), 'uploads', reqpath);
            // check exists
            if (!fs.existsSync(fpath)) {
                return res.status(400).json({
                    message: fpath + ' does not exist',
                    success: false
                });
            }
            let txt = await readTextFile(fpath);
            return res.status(200).json({
                message: 'OK',
                success: true,
                text: txt
            });
        });

        this.app.get('/download', authGuardAdmin, async function (req, res) {
            // check target is valid
            let reqpath = req.query.target;
            reqpath = decodeURIComponent(reqpath);
            console.log(reqpath);
            let fpath = path.join(process.cwd(), 'uploads', reqpath);
            console.log(fpath);
            // check exists
            if (!fs.existsSync(fpath)) {
                return res.status(400).json({
                    message: fpath + ' does not exist',
                    success: false
                });
            }
            res.status(200).download(fpath);
        });

        this.app.use((req, res) => {
            res.render('404.ejs');
        });
    }

    async listen(fn) {
        this.server.listen(process.env.EXPRESS_PORT, fn);
    }
}

module.exports = App;