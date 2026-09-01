const winston = require('winston');
const path    = require('path');

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const isProd = process.env.NODE_ENV === 'production';

const prettyFormat = combine(
    colorize(),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    printf(({ level, message, timestamp, stack, ...meta }) => {
        const extra = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
        return `${timestamp} [${level}]: ${stack || message}${extra}`;
    })
);

const jsonFormat = combine(
    timestamp(),
    errors({ stack: true }),
    json()
);

const root = path.resolve(__dirname, '../../');

const logger = winston.createLogger({
    level: isProd ? 'info' : 'debug',
    format: isProd ? jsonFormat : prettyFormat,
    transports: [
        new winston.transports.Console({
            format: isProd ? jsonFormat : prettyFormat,
        }),
        new winston.transports.File({
            filename: path.join(root, 'logs/errors/error.log'),
            level:    'error',
            format:   jsonFormat,
        }),
        new winston.transports.File({
            filename: path.join(root, 'logs/application/combined.log'),
            format:   jsonFormat,
        }),
    ],
});

module.exports = logger;
