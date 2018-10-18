const worker_version = '1.0.0';

// remove minimist if possible
var gulp = require('gulp'),
    $ = require('gulp-load-plugins')(),
    concat = require('gulp-concat'),
    connect = require('gulp-connect-php'),
    fs = require('fs'),
    sass = require('gulp-sass'),
    uglify = require('gulp-uglify'),
    plumber = require('gulp-plumber'),
    spritesmith = require('gulp.spritesmith'),
    process = require('process'),
    browserSync = require('browser-sync'),
    chokidar = require('chokidar'),
    path = require('path'),
    clc = require('cli-color'),
    env = {};

// you can also overwrite this path by: --mountpath /home/dexter
env.conf_file = "worker.config.json";
env.conf = JSON.parse(fs.readFileSync(env.conf_file));
env.cwd = '../';
env.root_path = (typeof env.conf.rootDir !== "undefined") ? '..' + env.conf.rootDir : '../main/'
if (env.root_path.slice(-1) != '/') env.root_path += '/';
env.node_version = process.version;

var conf_missing = !fs.existsSync(env.conf_file);

// define stylings
var error = clc.red,
    info = clc.xterm(39),
    warning = clc.yellow;

// define more arguments and parameters
env.pid = process.pid;
env.asset_dir = env.root_path + "/assets/";
env.scss_file = (typeof env.conf.scss.inputs === "undefined") ? env.asset_dir + 'css/scss/main.scss' : env.conf.scss.inputs;
env.css_dir = env.asset_dir + 'css';
env.scss_dir = env.asset_dir + 'css/scss/';
env.js_dir = env.asset_dir + 'js/';
env.img_dir = env.asset_dir + 'images/';
env.proxy = '127.0.0.1:3000';
env.scss_options = {
    errLogToConsole: true,
    outputStyle: env.conf.scss.outputStyle,
    includePaths: env.scss_dir
}

// arguments for gulp sprite
env.sprite_options = {
    cssName: '../css/scss/modules/_sprites.scss',
    imgName: 'sprites.png',
    algorithm: 'binary-tree',
    imgPath: '../images/sprites.png'
}

// files to watch and not to watch
env.watch_files = [
    env.root_path + '**/@(*.php|*.html|*.jpg|*.jpeg|*.png|*.gif|*.svg|*.css|*.scss|*.js)',
    '!' + env.asset_dir + 'css/main.css.map',
    '!' + env.asset_dir + 'css/main.css',
    '!' + env.asset_dir + 'js/site.js',
    '!' + env.asset_dir + 'js/site.js.map'
];

// edit to get file from repositorie
// var conf_template = (typeof argv.confTmp == 'string') ? argv.confTmp : env.init_cwd + '/example.conf.json';

// **********
// CONFIG END

// initial task
gulp.task('default', () => {
    log = {};

    log.file = env.cwd + '/local/worker.log';
    log.enableLog = (typeof env.conf.log === 'undefined' || env.conf.log === false) ? false : true;
    log.stream = fs.createWriteStream(log.file, { 'flags': 'a' });

    if (fs.existsSync(log.file)) fs.truncateSync(log.file);
    else {
        console.log(warning("Warning: Logfile is missing"));
        if (fs.writeFileSync(log.file, '')) {
            console.log(info("Created empty logfile " + log.file));
        }
        else {
            log.enableLog = false;
            console.log(error("Couldn't create logfile " + log.file + " - stopped logging"));
        }
    }

    // exit process if conf missing
    if (conf_missing || (!conf_missing && fs.statSync(env.conf_file).size == 0)) {
        if (fs.writeFileSync(env.conf_file, fs.readFileSync(conf_template))) {
            dlog("Default config created at " + env.conf_file, log);
            conf_missing = false;
        }
        else {
            dlog("conf.json is missing and couldn't be created...exiting");
            process.exit();
        }
    }

    dlog('Starting Worker in ' + env.cwd + ' (Root: ' + env.root_path + ')', log);

    browserSync.emitter.on("init", () => {
        dlog('Started BrowserSync', log);
    });
    browserSync.emitter.on("error", (err) => {
        dlog('Error: BrowserSync', log);
        dlog(err, log);
    });

    // check if js processing is needed
    if (typeof env.conf.javascript == 'undefined') {
        env.conf.javascript = true;
    }

    connect.server({ base: env.root_path }, () => {
        browserSync({
            base: env.root_path,
            keepAlive: true,
            ghostMode: {
                clicks: true,
                forms: false,
                scroll: false
            },
            notify: false,
            open: true,
            port: env.conf.browserSync.port,
            proxy: '127.0.0.1:8000',
            reloadOnRestart: false,
            ui: {
                weinre: {
                    boundHost: 'all'
                }
            }
        });
        console.log(info('Browsersync connected'));

        process.stdout.write(
            clc.columns([
                ["", clc.bold("base"), env.root_path, ""],
                ["", clc.bold("proxy"), "127.0.0.1:8000", ""],
                ["", clc.bold("port"), env.conf.browserSync.port, ""]
            ])
        )
    });

    var watcher = chokidar.watch(env.watch_files,
        {
            awaitWriteFinish: false,
            ignoreInitial: true,
            followSymlinks: false,
            usePolling: false,
            useFsEvents: false,
            read: false,
            readDelay: 0
        });

    watcher.on('change', (e) => {
        var ext = path.extname(e);

        if (ext == '.scss') scss();
        else if (ext == '.js' && env.conf.javascript) scripts();
        else if (e.indexOf('images/sprites') > -1) sprites();
        else browserSync.reload();
    });

    watcher.on('error', (err) => {
        dlog("Fatal Error: Watcher", log);
        dlog(err, log);
    });

    watcher
        .on('add', path => dlog(`Watcher: File ${path} has been added`, log))
        .on('unlink', path => dlog(`Watcher: File ${path} has been removed`, log))
        .on('addDir', path => dlog(`Watcher: Directory ${path} has been added`, log))
        .on('unlinkDir', path => dlog(`Watcher: Directory ${path} has been removed`, log))
        .on('ready', () => dlog('Watcher: Initial scan complete. Ready for changes', log));

    if (env.enableLog) watcher.on('raw', (event, path, details) => { console.log(info('Raw event info:', event, path, details)); });
});

function scss() {
    dlog("Executing SCSS compiling", log);
    console.log(info("Starting " + clc.bold("SCSS") + " compiler"));

    if (typeof env.scss_file === "string") {
        gulp
            .src(env.scss_file)
            .pipe(plumber({
                errorHandler: (err) => {
                    dlog("Error: SCSS compiling. Please see BS feedback.", log);
                    console.log(error(err.toString(), false));
                    this.emit('end');
                }
            }))
            .pipe($.sourcemaps.init())
            .pipe($.sass(env.scss_options))
            .pipe($.autoprefixer(env.conf.scss.autoprefix))
            .pipe($.sourcemaps.write('../css/'))
            .pipe(gulp.dest(env.css_dir))
            .pipe(browserSync.stream({ match: '**/*.css' }));
    } else {
        env.scss_file.forEach((file, index, files) => {
            gulp
                .src(env.root_path + file.src + file.name)
                .pipe(plumber({
                    errorHandler: (err) => {
                        dlog("Error: SCSS compiling. Please see BS feedback.", log);
                        console.log(error(err.toString(), false));
                        this.emit('end');
                    }
                }))
                .pipe($.sourcemaps.init())
                .pipe($.sass(env.scss_options))
                .pipe($.autoprefixer(env.conf.scss.autoprefix))
                .pipe($.sourcemaps.write(env.root_path + file.dest))
                .pipe(gulp.dest(env.root_path + file.dest));

            if (index === files.length) {
                gulp.on('end', () => {
                    browserSync.stream({ match: '**/*.css' })
                });
            }
        });

    }
};

function scripts() {
    dlog("Executing JS concatenation", log);
    return gulp
        .src([
            env.js_dir + '/jquery-1.11.3.min.js',
            env.js_dir + '/*.js',
            '!' + env.js_dir + '/tinymce_settings.js',
            '!' + env.js_dir + '/site.js'
        ])
        .pipe(plumber({
            errorHandler: (err) => {
                dlog("Error: JS concatenating failed. Please see BS feedback.", log);
                console.log(error(err.toString()));
                this.emit('end');
            }
        }))
        .pipe($.sourcemaps.init())
        .pipe(concat('site.js'))
        .pipe($.sourcemaps.write('../js/'))
        .pipe(gulp.dest(env.js_dir));
};

function sprites() {
    dlog("Executing Spritesmith", log);
    console.log(info("Starting " + clc.bold("Spritesmith")));
    return gulp
        .src(env.img_dir + '**/*.png').pipe(spritesmith(env.sprite_options))
        .pipe(gulp.dest(env.img_dir))
        .pipe(browserSync.reload());
}

function dlog(msg, log) {
    if (typeof log != 'undefined' && log.enableLog) {
        if (typeof msg == 'object') msg = stringify(msg);
        log.stream.write("[" + new Date() + "] " + msg + "\n");
    }
    else console.log(info(msg));
}


// https://github.com/moll/json-stringify-safe/blob/master/stringify.js
function stringify(obj, replacer, spaces, cycleReplacer) {
    return JSON.stringify(obj, serializer(replacer, cycleReplacer), spaces)
}

function serializer(replacer, cycleReplacer) {
    var stack = [], keys = []

    if (cycleReplacer == null) cycleReplacer = (key, value) => {
        if (stack[0] === value) return "[Circular ~]"
        return "[Circular ~." + keys.slice(0, stack.indexOf(value)).join(".") + "]"
    }

    return function (key, value) {
        if (stack.length > 0) {
            var thisPos = stack.indexOf(this)
            ~thisPos ? stack.splice(thisPos + 1) : stack.push(this)
            ~thisPos ? keys.splice(thisPos, Infinity, key) : keys.push(key)
            if (~stack.indexOf(value)) value = cycleReplacer.call(this, key, value)
        }
        else stack.push(value)

        return replacer == null ? value : replacer.call(this, key, value)
    }
}
