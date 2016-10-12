define([
    '/customize/messages.js',
    '/customize/store.js',
    '/bower_components/chainpad-crypto/crypto.js',
    '/bower_components/alertifyjs/dist/js/alertify.js',
    '/bower_components/spin.js/spin.min.js',

    '/customize/user.js',

    '/bower_components/jquery/dist/jquery.min.js',
], function (Messages, Store, Crypto, Alertify, Spinner, User) {
/*  This file exposes functionality which is specific to Cryptpad, but not to
    any particular pad type. This includes functions for committing metadata
    about pads to your local storage for future use and improved usability.

    Additionally, there is some basic functionality for import/export.
*/
    var $ = window.jQuery;

    var common = {
        User: User,
    };
    var store;
    var userProxy;
    var userStore;

    var find = common.find = function (map, path) {
        return (map && path.reduce(function (p, n) {
            return typeof(p[n]) !== 'undefined' && p[n];
        }, map));
    };

    var getStore = common.getStore = function (legacy) {
        if (!legacy && userStore) { return userStore; }
        if (store) { return store; }
        throw new Error("Store is not ready!");
    };

    /*
     *  cb(err, proxy);
     */
    var authorize = common.authorize = function (cb) {
        console.log("Authorizing");

        User.session(void 0, function (err, secret) {
            if (!secret) {
                // user is not authenticated
                cb('user is not authenticated', void 0);
            }

            // for now we assume that things always work
            User.connect(secret, function (err, proxy) {
                cb(void 0, proxy);
            });
        });
    };

    // HERE
    var deauthorize = common.deauthorize = function (cb) {
        console.log("Deauthorizing");

        // erase session data from storage
        User.session(null, function (err) {
            if (err) {
                console.error(err);
            }
            /*
                TODO better abort for this stuff...
            */
            userStore = undefined;
            userProxy = undefined;
        });
    };

    Store.ready(function (err, Store) {
        if (err) {
            console.error(err);
            return;
        }
        store = Store;
    });


    var isArray = function (o) { return Object.prototype.toString.call(o) === '[object Array]'; };

    var fixHTML = common.fixHTML = function (html) {
        return html.replace(/</g, '&lt;');
    };

    var truncate = common.truncate = function (text, len) {
        if (typeof(text) === 'string' && text.length > len) {
            return text.slice(0, len) + '…';
        }
        return text;
    };

    common.redirect = function (hash) {
        var hostname = window.location.hostname;

        // don't do anything funny unless you're on a cryptpad subdomain
        if (!/cryptpad.fr$/i.test(hostname)) { return; }

        if (hash.length >= 25) {
            // you're on the right domain
            return;
        }

        // old.cryptpad only supports these apps, so only redirect on a match
        if (['/pad/', '/p/', '/code/'].indexOf(window.location.pathname) === -1) {
            return;
        }

        // if you make it this far then there's something wrong with your hash
        // you should probably be on old.cryptpad.fr...

        window.location.hostname = 'old.cryptpad.fr';
    };

    var hexToBase64 = common.hexToBase64 = function (hex) {
        var hexArray = hex
            .replace(/\r|\n/g, "")
            .replace(/([\da-fA-F]{2}) ?/g, "0x$1 ")
            .replace(/ +$/, "")
            .split(" ");
        var byteString = String.fromCharCode.apply(null, hexArray);
        return window.btoa(byteString).replace(/\//g, '-').slice(0,-2);
    };

    var base64ToHex = common.base64ToHex = function (b64String) {
        var hexArray = [];
        atob(b64String.replace(/-/g, '/')).split("").forEach(function(e){
            var h = e.charCodeAt(0).toString(16);
            if (h.length === 1) { h = "0"+h; }
            hexArray.push(h);
        });
        return hexArray.join("");
    };


    var getEditHashFromKeys = common.getEditHashFromKeys = function (chanKey, keys) {
        if (typeof keys === 'string') {
            return chanKey + keys;
        }
        return '/1/edit/' + hexToBase64(chanKey) + '/' + Crypto.b64RemoveSlashes(keys.editKeyStr);
    };
    var getViewHashFromKeys = common.getViewHashFromKeys = function (chanKey, keys) {
        if (typeof keys === 'string') {
            return;
        }
        return '/1/view/' + hexToBase64(chanKey) + '/' + Crypto.b64RemoveSlashes(keys.viewKeyStr);
    };
    var getHashFromKeys = common.getHashFromKeys = getEditHashFromKeys;

    var getSecrets = common.getSecrets = function () {
        var secret = {};
        if (!/#/.test(window.location.href)) {
            secret.keys = Crypto.createEditCryptor();
            secret.key = Crypto.createEditCryptor().editKeyStr;
        } else {
            var hash = window.location.hash.slice(1);
            if (hash.length === 0) {
                secret.keys = Crypto.createEditCryptor();
                secret.key = Crypto.createEditCryptor().editKeyStr;
                return secret;
            }
            common.redirect(hash);
            // old hash system : #{hexChanKey}{cryptKey}
            // new hash system : #/{hashVersion}/{b64ChanKey}/{cryptKey}
            if (hash.slice(0,1) !== '/' && hash.length >= 56) {
                // Old hash
                secret.channel = hash.slice(0, 32);
                secret.key = hash.slice(32);
            }
            else {
                // New hash
                var hashArray = hash.split('/');
                if (hashArray.length < 4) {
                    common.alert("Unable to parse the key");
                    throw new Error("Unable to parse the key");
                }
                var version = hashArray[1];
                /*if (version === "1") {
                    secret.channel = base64ToHex(hashArray[2]);
                    secret.key = hashArray[3].replace(/-/g, '/');
                    if (secret.channel.length !== 32 || secret.key.length !== 24) {
                        common.alert("The channel key and/or the encryption key is invalid");
                        throw new Error("The channel key and/or the encryption key is invalid");
                    }
                }*/
                if (version === "1") {
                    var mode = hashArray[2];
                    if (mode === 'edit') {
                        secret.channel = base64ToHex(hashArray[3]);
                        var keys = Crypto.createEditCryptor(hashArray[4].replace(/-/g, '/'));
                        secret.keys = keys;
                        secret.key = keys.editKeyStr;
                        if (secret.channel.length !== 32 || secret.key.length !== 24) {
                            common.alert("The channel key and/or the encryption key is invalid");
                            throw new Error("The channel key and/or the encryption key is invalid");
                        }
                    }
                    else if (mode === 'view') {
                        secret.channel = base64ToHex(hashArray[3]);
                        secret.keys = Crypto.createViewCryptor(hashArray[4].replace(/-/g, '/'));
                        if (secret.channel.length !== 32) {
                            common.alert("The channel key is invalid");
                            throw new Error("The channel key is invalid");
                        }
                    }
                }
            }
        }
        return secret;
    };

    var storageKey = common.storageKey = 'CryptPad_RECENTPADS';

    /*
     *  localStorage formatting
     */
    /*
        the first time this gets called, your local storage will migrate to a
        new format. No more indices for values, everything is named now.

        * href
        * atime (access time)
        * title
        * ??? // what else can we put in here?
    */
    var migrateRecentPads = common.migrateRecentPads = function (pads) {
        return pads.map(function (pad) {
            if (isArray(pad)) {
                var href = pad[0];
                var hash;
                href.replace(/\#(.*)$/, function (a, h) {
                    hash = h;
                });

                return {
                    href: pad[0],
                    atime: pad[1],
                    title: pad[2] || hash && hash.slice(0,8),
                    ctime: pad[1],
                };
            } else if (typeof(pad) === 'object') {
                if (!pad.ctime) { pad.ctime = pad.atime; }
                if (!pad.title) {
                    pad.href.replace(/#(.*)$/, function (x, hash) {
                        pad.title = hash.slice(0,8);
                    });
                }
                pad.href = pad.href.replace(/^https:\/\/beta\.cryptpad\.fr/,
                    'https://cryptpad.fr');
                return pad;
            } else {
                console.error("[Cryptpad.migrateRecentPads] pad had unexpected value");
                console.log(pad);
                return {};
            }
        });
    };

    var getHash = common.getHash = function () {
        return window.location.hash.slice(1);
    };

    var parsePadUrl = common.parsePadUrl = function (href) {
        var patt = /^https*:\/\/([^\/]*)\/(.*?)\/#(.*)$/i;

        var ret = {};
        href.replace(patt, function (a, domain, type, hash) {
            ret.domain = domain;
            ret.type = type;
            ret.hash = hash;
            return '';
        });
        return ret;
    };

    var isNameAvailable = function (title, parsed, pads) {
        return !pads.some(function (pad) {
            // another pad is already using that title
            if (pad.title === title) {
                return true;
            }
        });
    };

    // Create untitled documents when no name is given
    var getDefaultName = common.getDefaultName = function (parsed, recentPads) {
        var type = parsed.type;
        var untitledIndex = 1;
        var name = (Messages.type)[type] + ' - ' + new Date().toString().split(' ').slice(0,4).join(' ');
        if (isNameAvailable(name, parsed, recentPads)) { return name; }
        while (!isNameAvailable(name + ' - ' + untitledIndex, parsed, recentPads)) { untitledIndex++; }
        return name + ' - ' + untitledIndex;
    };

    var makePad = function (href, title) {
        var now = ''+new Date();
        return {
            href: href,
            atime: now,
            ctime: now,
            title: title || window.location.hash.slice(1, 9),
        };
    };

    /* Sort pads according to how recently they were accessed */
    var mostRecent = common.mostRecent = function (a, b) {
        return new Date(b.atime).getTime() - new Date(a.atime).getTime();
    };

    // STORAGE
    var setPadAttribute = common.setPadAttribute = function (attr, value, cb, legacy) {
        getStore(legacy).set([getHash(), attr].join('.'), value, function (err, data) {
            cb(err, data);
        });
    };
    var setAttribute = common.setAttribute = function (attr, value, cb, legacy) {
        getStore(legacy).set(["cryptpad", attr].join('.'), value, function (err, data) {
            cb(err, data);
        });
    };


    // STORAGE
    var getPadAttribute = common.getPadAttribute = function (attr, cb, legacy) {
        getStore(legacy).get([getHash(), attr].join('.'), function (err, data) {
            cb(err, data);
        });
    };
    var getAttribute = common.getAttribute = function (attr, cb, legacy) {
        getStore(legacy).get(["cryptpad", attr].join('.'), function (err, data) {
            cb(err, data);
        });
    };


    // STORAGE
    /* fetch and migrate your pad history from localStorage */
    var getRecentPads = common.getRecentPads = function (cb, legacy) {
        getStore(legacy).get(storageKey, function (err, recentPads) {
            if (isArray(recentPads)) {
                cb(void 0, migrateRecentPads(recentPads));
                return;
            }
            cb(void 0, []);
        });
    };

    // STORAGE
    /* commit a list of pads to localStorage */
    var setRecentPads = common.setRecentPads = function (pads, cb, legacy) {
        getStore(legacy).set(storageKey, pads, function (err, data) {
            cb(err, data);
        });
    };

    // STORAGE
    var forgetPad = common.forgetPad = function (href, cb, legacy) {
        var parsed = parsePadUrl(href);

        getRecentPads(function (err, recentPads) {
            setRecentPads(recentPads.filter(function (pad) {
                var p = parsePadUrl(pad.href);
                // find duplicates
                if (parsed.hash === p.hash && parsed.type === p.type) {
                    console.log("Found a duplicate");
                    return;
                }
                return true;
            }), function (err, data) {
                if (err) {
                    cb(err);
                    return;
                }

                getStore(legacy).keys(function (err, keys) {
                    if (err) {
                        cb(err);
                        return;
                    }
                    var toRemove = keys.filter(function (k) {
                        return k.indexOf(parsed.hash) === 0;
                    });

                    if (!toRemove.length) {
                        cb();
                        return;
                    }
                    getStore(legacy).removeBatch(toRemove, function (err, data) {
                        cb(err, data);
                    });
                });
            }, legacy);
        }, legacy);
    };

    // STORAGE
    var rememberPad = common.rememberPad = window.rememberPad = function (title, cb) {
        // bail out early
        if (!/#/.test(window.location.hash)) { return; }

        getRecentPads(function (err, pads) {
            if (err) {
                cb(err);
                return;
            }

            var now = ''+new Date();
            var href = window.location.href;

            var parsed = parsePadUrl(window.location.href);
            var isUpdate = false;

            var out = pads.map(function (pad) {
                var p = parsePadUrl(pad.href);
                if (p.hash === parsed.hash && p.type === parsed.type) {
                    isUpdate = true;
                    // bump the atime
                    pad.atime = now;

                    pad.title = title;
                    pad.href = href;
                }
                return pad;
            });

            if (!isUpdate) {
                // href, ctime, atime, title
                out.push(makePad(href, title));
            }
            setRecentPads(out, function (err, data) {
                cb(err, data);
            });
        });
    };

    // STORAGE
    var setPadTitle = common.setPadTitle = function (name, cb) {
        var href = window.location.href;
        var parsed = parsePadUrl(href);

        getRecentPads(function (err, recent) {
            if (err) {
                cb(err);
                return;
            }

            var contains;

            var renamed = recent.map(function (pad) {
                var p = parsePadUrl(pad.href);
                if (p.hash === parsed.hash && p.type === parsed.type) {
                    contains = true;
                    // update the atime
                    pad.atime = new Date().toISOString();

                    // set the name
                    pad.title = name;
                    pad.href = href;
                }
                return pad;
            });

            if (!contains) {
                renamed.push(makePad(href, name));
            }

            setRecentPads(renamed, function (err, data) {
                cb(err, data);
            });
        });
    };

    // STORAGE
    var getPadTitle = common.getPadTitle = function (cb) {
        var href = window.location.href;
        var parsed = parsePadUrl(window.location.href);
        var hashSlice = window.location.hash.slice(1,9);
        var title = '';

        getRecentPads(function (err, pads) {
            if (err) {
                cb(err);
                return;
            }
            pads.some(function (pad) {
                var p = parsePadUrl(pad.href);
                if (p.hash === parsed.hash && p.type === parsed.type) {
                    title = pad.title || hashSlice;
                    return true;
                }
            });

            if (title === '') { title = getDefaultName(parsed, pads); }

            cb(void 0, title);
        });
    };

    // STORAGE
    var causesNamingConflict = common.causesNamingConflict = function (title, cb) {
        var href = window.location.href;

        var parsed = parsePadUrl(href);
        getRecentPads(function (err, pads) {
            if (err) {
                cb(err);
                return;
            }
            var conflicts = pads.some(function (pad) {
                // another pad is already using that title
                if (pad.title === title) {
                    var p = parsePadUrl(pad.href);

                    if (p.type === parsed.type && p.hash === parsed.hash) {
                        // the duplicate pad has the same type and hash
                        // allow renames
                    } else {
                        // it's an entirely different pad... it conflicts
                        return true;
                    }
                }
            });
            cb(void 0, conflicts);
        });
    };

    // local name?
    common.ready = function (f) {
        var state = 0;

        var env = {};

        var cb = function () {
            f(void 0, env);
        };

        Store.ready(function (err, store) {
            common.store = env.store = store;

            cb();
            return;
/*
            authorize(function (err, proxy) {
            /*
                TODO
                listen for log(in|out) events
                update information accordingly
            * /

                store.change(function (data) {
                    if (data.key === User.localKey) {
                        // HERE
                        if (!data.newValue) {
                            deauthorize(function (err) {
                                console.log("Deauthorized!!");
                            });
                        } else {
                            authorize(function (err, proxy) {
                                if (err) {
                                    // not logged in
                                }
                                if (!proxy) {
                                    userProxy = proxy;
                                    userStore =  User.prepareStore(proxy);
                                }
                            });
                        }
                    }
                });

                if (err) {
                    // not logged in
                }
                if (!proxy) {
                    cb();
                    return;
                }
                userProxy = env.proxy = proxy;
                userStore = env.userStore = User.prepareStore(proxy);
                cb();

            }); */
        });
    };

    /*
     *  Saving files
     */
    var fixFileName = common.fixFileName = function (filename) {
        return filename.replace(/ /g, '-').replace(/[\/\?]/g, '_')
            .replace(/_+/g, '_');
    };

    var importContent = common.importContent = function (type, f) {
        return function () {
            var $files = $('<input type="file">').click();
            $files.on('change', function (e) {
                var file = e.target.files[0];
                var reader = new FileReader();
                reader.onload = function (e) { f(e.target.result, file); };
                reader.readAsText(file, type);
            });
        };
    };

    /*
     *  Alertifyjs
     */
    var styleAlerts = common.styleAlerts = function (href) {
        var $link = $('link[href="/customize/alertify.css"]');
        if ($link.length) { return; }

        href = href || '/customize/alertify.css';
        $('head').append($('<link>', {
            rel: 'stylesheet',
            id: 'alertifyCSS',
            href: href,
        }));
    };

    var findCancelButton = common.findCancelButton = function () {
        return $('button.cancel');
    };

    var findOKButton = common.findOKButton = function () {
        return $('button.ok');
    };

    var listenForKeys = function (yes, no) {
        var handler = function (e) {
            switch (e.which) {
                case 27: // cancel
                    if (typeof(no) === 'function') { no(e); }
                    no();
                    break;
                case 13: // enter
                    if (typeof(yes) === 'function') { yes(e); }
                    break;
            }
        };

        $(window).keyup(handler);
        return handler;
    };

    var stopListening = function (handler) {
        $(window).off('keyup', handler);
    };

    common.alert = function (msg, cb) {
        cb = cb || function () {};
        var keyHandler = listenForKeys(function (e) { // yes
            findOKButton().click();
        });
        Alertify.alert(msg, function (ev) {
            cb(ev);
            stopListening(keyHandler);
        });
    };

    common.prompt = function (msg, def, cb, opt) {
        opt = opt || {};
        cb = cb || function () {};

        var keyHandler = listenForKeys(function (e) { // yes
            findOKButton().click();
        }, function (e) { // no
            findCancelButton().click();
        });

        Alertify
            .defaultValue(def || '')
            .okBtn(opt.ok || Messages.okButton || 'OK')
            .cancelBtn(opt.cancel || Messages.cancelButton || 'Cancel')
            .prompt(msg, function (val, ev) {
                cb(val, ev);
                stopListening(keyHandler);
            }, function (ev) {
                cb(null, ev);
                stopListening(keyHandler);
            });
    };

    common.confirm = function (msg, cb, opt) {
        opt = opt || {};
        cb = cb || function () {};
        var keyHandler = listenForKeys(function (e) {
            findOKButton().click();
        }, function (e) {
            findCancelButton().click();
        });

        Alertify
            .okBtn(opt.ok || Messages.okButton || 'OK')
            .cancelBtn(opt.cancel || Messages.cancelButton || 'Cancel')
            .confirm(msg, function () {
                cb(true);
                stopListening(keyHandler);
            }, function () {
                cb(false);
                stopListening(keyHandler);
            });
    };

    common.log = function (msg) {
        Alertify.success(msg);
    };

    common.warn = function (msg) {
        Alertify.error(msg);
    };

    /*
     *  spinner
     */
    common.spinner = function (parent) {
        var $target = $('<div>', {
            //
        }).hide();

        $(parent).append($target);

        var opts = {
            lines: 9, // The number of lines to draw
            length: 12, // The length of each line
            width: 11, // The line thickness
            radius: 20, // The radius of the inner circle
            scale: 2, // Scales overall size of the spinner
            corners: 1, // Corner roundness (0..1)
            color: '#777', // #rgb or #rrggbb or array of colors
            opacity: 0.3, // Opacity of the lines
            rotate: 31, // The rotation offset
            direction: 1, // 1: clockwise, -1: counterclockwise
            speed: 0.9, // Rounds per second
            trail: 49, // Afterglow percentage
            fps: 20, // Frames per second when using setTimeout() as a fallback for CSS
            zIndex: 2e9, // The z-index (defaults to 2000000000)
            className: 'spinner', // The CSS class to assign to the spinner
            top: '50%', // Top position relative to parent
            left: '50%', // Left position relative to parent
            shadow: false, // Whether to render a shadow
            hwaccel: false, // Whether to use hardware acceleration
            position: 'absolute', // Element positioning
        };
        var spinner = new Spinner(opts).spin($target[0]);

        return {
            show: function () {
                $target.show();
                return this;
            },
            hide: function () {
                $target.hide();
                return this;
            },
            get: function () {
                return spinner;
            },
        };
    };

    Messages._applyTranslation();

    return common;
});
