// imports
const bcrypt = require('bcryptjs');
const jwt = require("jsonwebtoken");
const config = require('../config/config');
const validators = require('../middlewares/validators');

// error handler
const loginControllerErrorHandler = require('../middlewares/errorHandler')

// Importing service's layer
const loginService = require('../services/loginService');
const manageUsers = require('../services/manageUserService');
const subscriptionService = require('../services/subscriptionService');

// Status codes
const { codes } = require('../config/codes')
const { InvalidCredentialsError, StatusError } = require('../errors/AuthError');

// Get user information
exports.processUserLogin = async (req, res, next) => {
    try {
        //Decryption, Validation and Sanitization
        let data = {};
        try {
            validators.validateEmail(req.body.email);
            validators.validatePassword(req.body.password);

            data = {
                email: validators.validateEmail(req.body.email),
                password: validators.validatePassword(req.body.password),
            };
        } catch (error) {
            // console.log(error.message);
            // return res.status(406).send(codes(406, 'Not Acceptable'));
            throw new InvalidCredentialsError();
        }

        let { email, password } = data;

        // Checking for invalid credentials
        let results = await loginService.authenticateUser(email);

        // Checking for invalid credentials
        if ((password == null) || (results[0] == null)) {
            // return res.status(401).send(codes(401, 'Invalid Credentials.', 'Your email or password is invalid.'));
            throw new InvalidCredentialsError();
        }

        // Check for pending users, i.e. haven't verified their account yet
        if (results[0].status == 2) {
            // return res.status(401).send(codes(401, 'Unverified.', 'Please check your email. You need to verify your account.'));
            throw new StatusError('Unverified');
        }

        // Checking for banned user
        if (results[0].status == 1) {
            // return res.status(403).send(codes(403, 'Banned.', "Your account has been banned. Please contact an administrator."));
            throw new StatusError('Banned');
        }

        // check for locked account
        if (results[0].login_attempt == 10) {
            // return res.status(403).send(codes(403, 'Locked Out.', 'Your account has been locked. Please reset your password before proceeding.'));
            throw new StatusError('Locked out');
        }

        if (bcrypt.compareSync(password, results[0].password_hash)) {
            let data = {
                displayName: results[0].first_name + " " + results[0].last_name,
                email: results[0].email,
                token: jwt.sign({
                    user_guid: results[0].user_guid,
                    email: results[0].email,
                    privilege: results[0].privilege
                },
                    config.JWTKey, {
                    expiresIn: 3 * 60 //Expires in 3 mins
                })
            };

            let refresh_token = jwt.sign(
                {
                    _id: results[0].user_guid
                }, config.REFRESH_TOKEN_SECRET,
                {
                    expiresIn: eval(config.REFRESH_TOKEN_EXPIRY)
                }
            );

            let insertRefreshToken = await manageUsers.addRefreshToken(results[0].user_guid, refresh_token);

            if (insertRefreshToken) {
                let customerInformation = await subscriptionService.getCustomerInformation(results[0].user_id);

                res.cookie('refreshToken', refresh_token, {
                    httpOnly: true,
                    secure: true,
                    signed: true,
                    maxAge: 60 * 60 * 24 * 3 * 1000, //3 days
                    sameSite: "none",
                });

                res.cookie('customer', customerInformation[0].customer_stripe_id, {
                    maxAge: 60 * 60 * 24 * 3 * 1000, httpOnly: true
                });

                await manageUsers.updateLoginAttempts(0, results[0].user_id);
                return res.status(200).send(data);
            } else {
                // return res.status(401).send(codes(401, 'Login failed.', 'Your email or password is invalid.'));
                throw new InvalidCredentialsError();
            }

        } else {
            console.log('here3');
            await manageUsers.updateLoginAttempts(results[0].login_attempt + 1, results[0].user_id);
            // return res.status(401).send(codes(401, 'Login failed.', 'Your email or password is invalid.'));
            throw new InvalidCredentialsError();
        }
    } catch (error) {
        console.log(error);

        if (error == "User does not exist") {
            // return res.status(401).send(codes(401, 'Login failed.', 'Your email or password is invalid.'));
            next(new InvalidCredentialsError());
        }

        // return res.status(500).send(codes(500, 'Internal error', 'Please contact an administrator for help.'));
        next(error);
    }
};