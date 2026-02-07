// Import required packages
const express = require('express');
const fs = require('fs');
const util = require('util');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') }); // Load environment variables from .env file
const oracledb = require('oracledb');
const cors = require('cors');
const nodemailer = require('nodemailer');

// Configure OracleDB to fetch CLOBs as strings to avoid circular JSON errors
oracledb.fetchAsString = [oracledb.CLOB];

// --- Oracle Instant Client Initialization ---
try {
  // For Windows (uncomment and adjust path if needed)
  // oracledb.initOracleClient({ libDir: "C:\\oracle\\instantclient_21_3" });
  
  console.log("Oracle Client initialization attempted.");
} catch (err) {
  console.error("Oracle Instant Client initialization warning:", err.message);
  console.log("Continuing with system-installed Oracle client...");
}

// --- Database Connection Configuration ---
const dbConfig = {
    user: process.env.DB_USER || "hotel_admin",
    password: process.env.DB_PASSWORD || "myStrongPassword",
    connectString: process.env.DB_CONNECT_STRING || "localhost:1521/XEPDB1"
};

// --- Server Configuration ---
const app = express();
const port = process.env.PORT || 3000;

// --- Real-time Logging Configuration ---
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR);
}

const LOG_FILE = path.join(LOG_DIR, 'app.log');
const ERROR_FILE = path.join(LOG_DIR, 'error.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
const LOG_RETENTION_DAYS = 30;

function cleanupOldLogs() {
    fs.readdir(LOG_DIR, (err, files) => {
        if (err) {
            process.stdout.write(`[System] Failed to read log directory for cleanup: ${err.message}\n`);
            return;
        }

        const now = Date.now();
        const retentionMs = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

        files.forEach(file => {
            if (file === 'app.log' || file === 'error.log') return; // Skip active log files
            const filePath = path.join(LOG_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;

                if (now - stats.mtime.getTime() > retentionMs) {
                    fs.unlink(filePath, (err) => {
                        if (err) {
                            process.stdout.write(`[System] Failed to delete old log file ${file}: ${err.message}\n`);
                        } else {
                            process.stdout.write(`[System] Deleted old log file: ${file}\n`);
                        }
                    });
                }
            });
        });
    });
}

// Schedule cleanup every 24 hours
setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);
// Run cleanup on startup
cleanupOldLogs();

function rotateLogFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            if (stats.size >= MAX_LOG_SIZE) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const rotatedPath = `${filePath}.${timestamp}`;
                fs.renameSync(filePath, rotatedPath);
                process.stdout.write(`[System] Rotated log file: ${path.basename(filePath)} -> ${path.basename(rotatedPath)}\n`);
            }
        }
    } catch (err) {
        process.stdout.write(`Failed to rotate log file: ${err.message}\n`);
    }
}

function writeLog(level, message) {
    rotateLogFile(LOG_FILE);
    if (level === 'ERROR') rotateLogFile(ERROR_FILE);

    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level}] ${message}\n`;
    
    // Write to general log file
    fs.appendFile(LOG_FILE, logEntry, (err) => {
        if (err) process.stdout.write(`Failed to write to log file: ${err.message}\n`);
    });

    // Write to error log file if it's an error
    if (level === 'ERROR') {
        fs.appendFile(ERROR_FILE, logEntry, (err) => {
            if (err) process.stdout.write(`Failed to write to error file: ${err.message}\n`);
        });
    }
}

// Override console methods to capture all logs to file
const originalLog = console.log;
const originalError = console.error;

console.log = function(...args) {
    const msg = util.format(...args);
    writeLog('INFO', msg);
    originalLog.apply(console, args);
};

console.error = function(...args) {
    const msg = util.format(...args);
    writeLog('ERROR', msg);
    originalError.apply(console, args);
};

// --- Email Configuration (Nodemailer) ---
const transporter = nodemailer.createTransport({
    service: 'gmail', // Use your email provider (e.g., 'gmail', 'outlook')
    auth: {
        user: process.env.EMAIL_USER, // Add EMAIL_USER to your .env file
        pass: process.env.EMAIL_PASS ? process.env.EMAIL_PASS.replace(/\s+/g, '') : '' // Remove spaces if present
    }
});

// --- Email Template Helper ---
function createEmailTemplate(title, bodyContent) {
    return `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e6e6e6; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
        <div style="background-color: #2c3e50; padding: 25px; text-align: center;">
            <h2 style="color: #ffffff; margin: 0; font-weight: 500;">${title}</h2>
        </div>
        <div style="padding: 30px; color: #444444; line-height: 1.6; font-size: 16px;">
            ${bodyContent}
        </div>
        <div style="background-color: #f8f9fa; padding: 15px; text-align: center; font-size: 12px; color: #999999; border-top: 1px solid #e6e6e6;">
            <p style="margin: 0;">Hotel Management System Notification</p>
        </div>
    </div>`;
}

async function sendEmail(to, subject, text, html = null) {
    // Check if credentials are set to avoid "Missing credentials" error
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || process.env.EMAIL_USER === 'your-email@gmail.com') {
        console.log(`⚠️ Email credentials missing in .env. Logging email content to console:`);
        console.log(`   To: ${to} | Subject: ${subject}`);
        console.log(`   Body: ${text}`);
        return;
    }
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: to,
            subject: subject,
            text: text,
            html: html || undefined
        });
        console.log(`📧 Email sent to ${to}`);
    } catch (error) {
        console.error('❌ Error sending email:', error);
        // Fallback: Log the content so the OTP isn't lost
        console.log(`   Body: ${text}`);
    }
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased limit for room photos
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- HTTP Request Logger Middleware ---
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms - IP: ${req.ip}`);
    });
    next();
});

// In-memory store for OTP simulation. In production, use a more robust solution like Redis.
const otpStore = {};
// In-memory store for Password Reset Tokens
const resetTokenStore = {};

// Serve static frontend files from the parent directory
app.use(express.static(path.join(__dirname, '../')));

app.get('/api/health', (req, res) => {
    res.json({ status: 'API is healthy' });
});

// --- Database & Server Initialization ---
async function startServer() {
    let pool;
    let apiEnabled = true;
    let server;
    
    // Define granular API controls
    const apiGroups = {
        'Guest Management API': { enabled: true, paths: ['/api/guests', '/api/guest'] },
        'Room Operations API': { enabled: true, paths: ['/api/rooms'] },
        'Booking System API': { enabled: true, paths: ['/api/online-bookings'] },
        'Billing & History API': { enabled: true, paths: ['/api/billing', '/api/history'] },
        'Food & Dining API': { enabled: true, paths: ['/api/food-orders', '/api/menu'] },
        'Service Requests API': { enabled: true, paths: ['/api/service-requests', '/api/maintenance'] },
        'User Management API': { enabled: true, paths: ['/api/users', '/api/register'] },
        'Hotel Information API': { enabled: true, paths: ['/api/hotels', '/api/hotel'] },
        'Notifications & Broadcasts API': { enabled: true, paths: ['/api/notifications', '/api/broadcast', '/api/owner/broadcast'] },
        'Password Recovery API': { enabled: true, paths: ['/api/auth'] },
        'Admin Operations API': { enabled: true, paths: ['/api/admin'] }
    };

    // Helper to generate unique hotel slug
    async function generateUniqueSlug(hotelName, connection, excludeUserId = null) {
        let baseSlug = hotelName.toLowerCase().replace(/[^a-z0-9]/g, '');
        let slug = baseSlug + '.com';
        let counter = 1;
        
        while (true) {
            let sql = `SELECT count(*) FROM hms_users WHERE hotel_slug = :slug`;
            const binds = { slug };
            
            if (excludeUserId) {
                sql += ` AND user_id != :excludeUserId`;
                binds.excludeUserId = excludeUserId;
            }

            const result = await connection.execute(sql, binds); // Default array output
            if (result.rows[0][0] === 0) return slug;
            
            slug = `${baseSlug}${counter}.com`;
            counter++;
        }
    }

    // Helper function to initialize or re-initialize the database pool
    const initDb = async () => {
        try {
            if (pool) {
                try { await pool.close(); } catch (e) { console.error("Error closing old pool:", e.message); }
            }
            console.log("Attempting to connect to Oracle Database...");
            pool = await oracledb.createPool(dbConfig);
            console.log("✅ Oracle Database connection pool created successfully.");
            return true;
        } catch (err) {
            console.error("❌ Database Connection Failed:", err.message);
            return false;
        }
    };

    // Helper to ensure DB Schema supports multi-hotel features
    const checkAndMigrateSchema = async () => {
        let connection;
        try {
            connection = await pool.getConnection();
            // Try adding hotel_name to food_menu
            try { await connection.execute("ALTER TABLE food_menu ADD hotel_name VARCHAR2(100)"); console.log("✅ Schema updated: Added hotel_name to food_menu"); } catch (e) { /* Ignore if exists */ }
            
            // Try adding hotel_name to food_orders
            try { await connection.execute("ALTER TABLE food_orders ADD hotel_name VARCHAR2(100)"); console.log("✅ Schema updated: Added hotel_name to food_orders"); } catch (e) { /* Ignore if exists */ }
            
            // Try adding hotel_name to hms_rooms
            try { await connection.execute("ALTER TABLE hms_rooms ADD hotel_name VARCHAR2(100)"); console.log("✅ Schema updated: Added hotel_name to hms_rooms"); } catch (e) { /* Ignore if exists */ }
            try { await connection.execute("ALTER TABLE hms_rooms ADD photos CLOB"); console.log("✅ Schema updated: Added photos to hms_rooms"); } catch (e) { /* Ignore if exists */ }

            // Try adding hotel_name to hms_guests
            try { await connection.execute("ALTER TABLE hms_guests ADD hotel_name VARCHAR2(100)"); console.log("✅ Schema updated: Added hotel_name to hms_guests"); } catch (e) { /* Ignore if exists */ }
            // Try adding address and verification details to hms_guests if missing
            try { await connection.execute("ALTER TABLE hms_guests ADD address VARCHAR2(255)"); console.log("✅ Schema updated: Added address to hms_guests"); } catch (e) { }
            try { await connection.execute("ALTER TABLE hms_guests ADD verification_id_type VARCHAR2(50)"); console.log("✅ Schema updated: Added verification_id_type to hms_guests"); } catch (e) { }
            try { await connection.execute("ALTER TABLE hms_guests ADD verification_id VARCHAR2(100)"); console.log("✅ Schema updated: Added verification_id to hms_guests"); } catch (e) { }

            // Try adding hotel_name to hms_online_bookings
            try { await connection.execute("ALTER TABLE hms_online_bookings ADD hotel_name VARCHAR2(100)"); console.log("✅ Schema updated: Added hotel_name to hms_online_bookings"); } catch (e) { /* Ignore if exists */ }
            try { await connection.execute("ALTER TABLE hms_online_bookings ADD mobile_number VARCHAR2(20)"); console.log("✅ Schema updated: Added mobile_number to hms_online_bookings"); } catch (e) { }
            try { await connection.execute("ALTER TABLE hms_online_bookings ADD country_code VARCHAR2(10)"); console.log("✅ Schema updated: Added country_code to hms_online_bookings"); } catch (e) { }
            try { await connection.execute("ALTER TABLE hms_online_bookings ADD check_in_time TIMESTAMP"); console.log("✅ Schema updated: Added check_in_time to hms_online_bookings"); } catch (e) { }
            try { await connection.execute("ALTER TABLE hms_online_bookings ADD check_out_time TIMESTAMP"); console.log("✅ Schema updated: Added check_out_time to hms_online_bookings"); } catch (e) { }
            try { await connection.execute("ALTER TABLE hms_online_bookings ADD updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"); console.log("✅ Schema updated: Added updated_at to hms_online_bookings"); } catch (e) { }

            // Try adding hotel_name to hms_bill_history
            try { await connection.execute("ALTER TABLE hms_bill_history ADD hotel_name VARCHAR2(100)"); console.log("✅ Schema updated: Added hotel_name to hms_bill_history"); } catch (e) { /* Ignore if exists */ }

            // Data Migration: Set default hotel for existing records with NULL hotel_name
            const defaultHotel = 'HMS_GLOBAL'; 
            try { await connection.execute(`UPDATE hms_rooms SET hotel_name = '${defaultHotel}' WHERE hotel_name IS NULL`); } catch (e) {}
            try { await connection.execute(`UPDATE hms_guests SET hotel_name = '${defaultHotel}' WHERE hotel_name IS NULL`); } catch (e) {}
            try { await connection.execute(`UPDATE food_menu SET hotel_name = '${defaultHotel}' WHERE hotel_name IS NULL`); } catch (e) {}
            try { await connection.execute(`UPDATE food_orders SET hotel_name = '${defaultHotel}' WHERE hotel_name IS NULL`); } catch (e) {}
            try { await connection.execute(`UPDATE hms_bill_history SET hotel_name = '${defaultHotel}' WHERE hotel_name IS NULL`); } catch (e) {}
            try { await connection.execute(`UPDATE hms_online_bookings SET hotel_name = '${defaultHotel}' WHERE hotel_name IS NULL`); } catch (e) {}
            
            // Try adding hotel_name to hms_users and migrate data
            try { await connection.execute("ALTER TABLE hms_users ADD hotel_name VARCHAR2(100)"); console.log("✅ Schema updated: Added hotel_name to hms_users"); } catch (e) { /* Ignore if exists */ }
            try { await connection.execute(`UPDATE hms_users SET hotel_name = '${defaultHotel}' WHERE hotel_name IS NULL`); } catch (e) {}
            try { await connection.execute("ALTER TABLE hms_users ADD profile_picture CLOB"); console.log("✅ Schema updated: Added profile_picture to hms_users"); } catch (e) {}
            try { await connection.execute("ALTER TABLE hms_users ADD read_notifications CLOB"); console.log("✅ Schema updated: Added read_notifications to hms_users"); } catch (e) {}
            try { await connection.execute("ALTER TABLE hms_users ADD address VARCHAR2(255)"); console.log("✅ Schema updated: Added address to hms_users"); } catch (e) {}
            try { await connection.execute("ALTER TABLE hms_users ADD hotel_slug VARCHAR2(255)"); console.log("✅ Schema updated: Added hotel_slug to hms_users"); } catch (e) {}

            // Backfill hotel_slug for existing owners
            try {
                const ownersWithoutSlug = await connection.execute(
                    `SELECT user_id, hotel_name FROM hms_users WHERE role = 'Owner' AND hotel_slug IS NULL AND hotel_name IS NOT NULL`,
                    [],
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                
                if (ownersWithoutSlug.rows.length > 0) {
                    console.log(`Found ${ownersWithoutSlug.rows.length} owners without slugs. Generating...`);
                    for (const owner of ownersWithoutSlug.rows) {
                        const slug = owner.HOTEL_NAME.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
                        await connection.execute(
                            `UPDATE hms_users SET hotel_slug = :slug WHERE user_id = :id`,
                            { slug: slug, id: owner.USER_ID },
                            { autoCommit: true }
                        );
                        console.log(`Generated slug '${slug}' for hotel '${owner.HOTEL_NAME}'`);
                    }
                }
            } catch (e) {
                console.error("Error backfilling hotel slugs:", e);
            }

            // Try creating hms_broadcasts table
            try { 
                await connection.execute(`
                    CREATE TABLE hms_broadcasts (
                        id NUMBER GENERATED ALWAYS AS IDENTITY, 
                        message VARCHAR2(4000), 
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
                        is_active NUMBER(1) DEFAULT 1
                    )
                `); 
                console.log("✅ Schema updated: Created hms_broadcasts table"); 
            } catch (e) { /* Ignore if exists */ }

            // Try adding hotel_name to hms_broadcasts for Owner->Staff broadcasts
            try { await connection.execute("ALTER TABLE hms_broadcasts ADD hotel_name VARCHAR2(100)"); console.log("✅ Schema updated: Added hotel_name to hms_broadcasts"); } catch (e) { /* Ignore if exists */ }

            // Try adding hotel_name to service_requests
            try { await connection.execute("ALTER TABLE service_requests ADD hotel_name VARCHAR2(100)"); console.log("✅ Schema updated: Added hotel_name to service_requests"); } catch (e) { /* Ignore if exists */ }

            // Try creating maintenance_logs table
            try { 
                await connection.execute(`
                    CREATE TABLE maintenance_logs (
                        id NUMBER GENERATED ALWAYS AS IDENTITY, 
                        room_number VARCHAR2(50),
                        item_name VARCHAR2(100),
                        description VARCHAR2(4000),
                        priority VARCHAR2(20) DEFAULT 'Medium',
                        status VARCHAR2(20) DEFAULT 'Reported',
                        reported_by VARCHAR2(100),
                        hotel_name VARCHAR2(100),
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `); 
                console.log("✅ Schema updated: Created maintenance_logs table"); 
            } catch (e) { /* Ignore if exists */ }

            // Try adding photo to maintenance_logs
            try { await connection.execute("ALTER TABLE maintenance_logs ADD photo CLOB"); console.log("✅ Schema updated: Added photo to maintenance_logs"); } catch (e) { /* Ignore if exists */ }

            // Try creating hms_lost_found table
            try { 
                await connection.execute(`
                    CREATE TABLE hms_lost_found (
                        id NUMBER GENERATED ALWAYS AS IDENTITY, 
                        item_name VARCHAR2(100), 
                        description VARCHAR2(4000), 
                        found_location VARCHAR2(100),
                        found_by VARCHAR2(100),
                        status VARCHAR2(20) DEFAULT 'Found',
                        claimed_by VARCHAR2(100),
                        date_found TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        date_claimed TIMESTAMP,
                        hotel_name VARCHAR2(100)
                    )
                `); 
                console.log("✅ Schema updated: Created hms_lost_found table"); 
            } catch (e) { /* Ignore if exists */ }

            // Food Menu Migrations
            try { await connection.execute("ALTER TABLE food_menu ADD image_url CLOB"); console.log("✅ Schema updated: Added image_url to food_menu"); } catch (e) {}
            try { await connection.execute("ALTER TABLE food_menu ADD category VARCHAR2(100)"); console.log("✅ Schema updated: Added category to food_menu"); } catch (e) {}
            try { await connection.execute("ALTER TABLE food_menu ADD is_available NUMBER(1) DEFAULT 1"); console.log("✅ Schema updated: Added is_available to food_menu"); } catch (e) {}

            // User Settings Migrations
            try { await connection.execute("ALTER TABLE hms_users ADD is_dark_mode NUMBER(1) DEFAULT 0"); console.log("✅ Schema updated: Added is_dark_mode"); } catch (e) {}
            try { await connection.execute("ALTER TABLE hms_users ADD notification_volume NUMBER(3,2) DEFAULT 1.0"); console.log("✅ Schema updated: Added notification_volume"); } catch (e) {}
            try { await connection.execute("ALTER TABLE hms_users ADD notification_sound CLOB"); console.log("✅ Schema updated: Added notification_sound"); } catch (e) {}
            try { await connection.execute("ALTER TABLE hms_users ADD last_read_broadcast VARCHAR2(4000)"); console.log("✅ Schema updated: Added last_read_broadcast"); } catch (e) {}

            // Try creating hotel_features table
            try { 
                await connection.execute(`
                    CREATE TABLE hotel_features (
                        id NUMBER GENERATED ALWAYS AS IDENTITY, 
                        feature_text VARCHAR2(255), 
                        hotel_name VARCHAR2(100)
                    )
                `); 
                console.log("✅ Schema updated: Created hotel_features table"); 
            } catch (e) { /* Ignore if exists */ }

            // Add icon to hotel_features and scroll speed to users
            try { await connection.execute("ALTER TABLE hotel_features ADD icon VARCHAR2(50) DEFAULT 'fa-star'"); console.log("✅ Schema updated: Added icon to hotel_features"); } catch (e) {}
            try { await connection.execute("ALTER TABLE hms_users ADD feature_scroll_speed NUMBER DEFAULT 20"); console.log("✅ Schema updated: Added feature_scroll_speed to hms_users"); } catch (e) {}
            try { await connection.execute("ALTER TABLE hms_users ADD upi_id VARCHAR2(100)"); console.log("✅ Schema updated: Added upi_id to hms_users"); } catch (e) {}
            try { await connection.execute("ALTER TABLE hms_bill_history ADD payment_mode VARCHAR2(50)"); console.log("✅ Schema updated: Added payment_mode to hms_bill_history"); } catch (e) {}
            try { await connection.execute("ALTER TABLE hms_users ADD theme_color VARCHAR2(20)"); console.log("✅ Schema updated: Added theme_color to hms_users"); } catch (e) {}
            
            // Try creating hms_employee_details table
            try { 
                await connection.execute(`
                    CREATE TABLE hms_employee_details (
                        user_id NUMBER, salary NUMBER, bank_account VARCHAR2(50), ifsc VARCHAR2(20), reports_to NUMBER,
                        CONSTRAINT fk_emp_det_user FOREIGN KEY (user_id) REFERENCES hms_users(user_id) ON DELETE CASCADE
                    )
                `); 
                console.log("✅ Schema updated: Created hms_employee_details table"); 
            } catch (e) { /* Ignore if exists */ }

            // Try creating hms_ui_settings table
            try { 
                await connection.execute(`
                    CREATE TABLE hms_ui_settings (
                        id NUMBER GENERATED ALWAYS AS IDENTITY, 
                        hotel_name VARCHAR2(100),
                        primary_color VARCHAR2(20),
                        secondary_color VARCHAR2(20),
                        sidebar_bg VARCHAR2(20),
                        sidebar_text VARCHAR2(20),
                        bg_color VARCHAR2(20),
                        surface_color VARCHAR2(20),
                        text_color VARCHAR2(20),
                        guest_login_bg VARCHAR2(20),
                        CONSTRAINT unique_hotel_ui UNIQUE (hotel_name)
                    )
                `); 
                console.log("✅ Schema updated: Created hms_ui_settings table"); 
            } catch (e) { /* Ignore if exists */ }

        } catch (err) {
            console.error("Schema Migration Warning:", err.message);
        } finally {
            if (connection) await connection.close();
        }
    };

    // --- API Control Middleware ---
    app.use((req, res, next) => {
        // Allow control routes and health check always
        if (req.path.startsWith('/api/admin/control') || req.path === '/api/health' || req.path === '/api/login' || req.path === '/api/admin/system-health') {
            return next();
        }
        if (!apiEnabled && req.path.startsWith('/api')) {
            return res.status(503).json({ message: 'System is in maintenance mode. APIs are stopped.' });
        }
        
        // Granular check
        for (const [groupName, config] of Object.entries(apiGroups)) {
            if (!config.enabled && config.paths.some(p => req.path.startsWith(p))) {
                return res.status(503).json({ message: `${groupName} is currently disabled.` });
            }
        }
        next();
    });

    try {
        // Attempt initial connection (non-blocking for server start)
        await initDb();
        if (pool) await checkAndMigrateSchema();

        // --- Configuration Validation ---
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            console.error("\n⚠️ WARNING: Email credentials are not configured.");
            console.error("Please add EMAIL_USER and EMAIL_PASS to your .env file.");
            console.error("-------------------------------------------------");
            console.error("EMAIL_USER=your-email@gmail.com");
            console.error("EMAIL_PASS=your-app-password");
            console.error("-------------------------------------------------\n");
            // throw new Error("Twilio configuration is missing. Server startup aborted."); // Don't crash, just warn
        }

        // --- API ROUTES ---

        // --- GUEST AUTH & BOOKING ROUTES ---

        app.post('/api/guest/send-otp', async (req, res) => {
            const { email } = req.body;
            if (!email) {
                return res.status(400).json({ message: 'Email is required.' });
            }
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            otpStore[email] = { otp: otp, timestamp: Date.now() };
        
            const html = createEmailTemplate('Verification Code', `<p>Your verification code is:</p><h2 style="color: #007bff; text-align: center; letter-spacing: 5px;">${otp}</h2>`);
            await sendEmail(email, 'HMS Verification Code', `Your verification code is: ${otp}`, html);
            res.json({ message: 'OTP has been sent to your email.' });
        });

        app.post('/api/guest/verify-otp', (req, res) => {
            const { email, otp } = req.body;
            const storedOtpData = otpStore[email];
            const fiveMinutes = 5 * 60 * 1000;

            if (storedOtpData && storedOtpData.otp === otp && (Date.now() - storedOtpData.timestamp < fiveMinutes)) {
                delete otpStore[email]; // OTP is single-use
                res.json({ success: true, message: 'OTP verified successfully.' });
            } else {
                res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
            }
        });

        app.post('/api/guest/verify-dinein', async (req, res) => {
            const { identifier, hotelName } = req.body;
            console.log(`Verifying dine-in guest: Identifier='${identifier}', Hotel='${hotelName}'`);
            if (!identifier || !hotelName) {
                return res.status(400).json({ message: 'Identifier and Hotel Name required.' });
            }

            let connection;
            try {
                connection = await pool.getConnection();
                // Improved query: Case-insensitive email, and check both mobile and full mobile (code+number)
                const sql = `SELECT guest_name, room_number FROM hms_guests 
                             WHERE (LOWER(email) = LOWER(:id) 
                                 OR mobile_number = :id 
                                 OR (country_code || mobile_number) = :id) 
                             AND hotel_name = :hotelName`;
                
                const result = await connection.execute(sql, { id: identifier, hotelName }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

                if (result.rows.length > 0) {
                    const guest = result.rows[0];
                    res.json({ success: true, guestName: guest.GUEST_NAME, roomNumber: guest.ROOM_NUMBER });
                } else {
                    res.status(404).json({ success: false, message: 'No active guest found with these details.' });
                }
            } catch (err) {
                console.error("Verify Dine-in Guest Error:", err);
                res.status(500).json({ message: 'Server error.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // --- Calendar Availability Endpoint ---
        app.get('/api/hotels/calendar-availability', async (req, res) => {
            const { hotelName, roomType, month, year } = req.query;
            if (!hotelName || !roomType || !month || !year) return res.json([]);

            let connection;
            try {
                connection = await pool.getConnection();
                
                // 1. Get Total Rooms of Type
                const totalRes = await connection.execute(
                    `SELECT count(*) as count FROM hms_rooms WHERE hotel_name = :hotelName AND room_type = :roomType`,
                    { hotelName, roomType }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                const totalRooms = totalRes.rows[0].COUNT;

                // 2. Get Bookings for the Month
                // Simple logic: Get all bookings that overlap with this month
                const startOfMonth = new Date(year, month - 1, 1);
                const endOfMonth = new Date(year, month, 0, 23, 59, 59);

                const bookingsRes = await connection.execute(
                    `SELECT check_in_time, check_out_time FROM hms_online_bookings 
                     WHERE hotel_name = :hotelName AND room_type = :roomType 
                     AND booking_status IN ('Booked', 'Confirmed', 'Pending Payment')
                     AND (check_in_time <= :endOfMonth AND check_out_time >= :startOfMonth)`,
                    { hotelName, roomType, startOfMonth, endOfMonth },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );

                res.json({ totalRooms, bookings: bookingsRes.rows });
            } catch (err) {
                console.error("Calendar Availability Error:", err);
                res.status(500).json({ message: 'Failed to fetch calendar data.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.post('/api/online-bookings', async (req, res) => {
            const { guestName, email, roomType, hotelName, checkIn, duration } = req.body;
            if (!guestName || !email || !roomType || !hotelName || !checkIn || !duration) {
                return res.status(400).json({ message: 'Please complete all booking details (Name, Email, Room Type, Date, Duration).' });
            }

            const checkinOtp = Math.floor(100000 + Math.random() * 900000).toString();
            // Log the check-in OTP for simulation purposes
            console.log(`\n--- 🔑 Check-in OTP for booking by ${guestName} (${email}) is: ${checkinOtp} ---\n`);

            const checkInDate = new Date(checkIn);
            const checkOutDate = new Date(checkInDate.getTime() + (duration * 60 * 60 * 1000));

            const sql = `INSERT INTO hms_online_bookings (guest_name, email, room_type, otp, hotel_name, mobile_number, country_code, check_in_time, check_out_time, booking_status) 
                         VALUES (:guestName, :email, :roomType, :otp, :hotelName, '0000000000', '+00', :checkInDate, :checkOutDate, 'Booked')
                         RETURNING booking_id INTO :bookingId`;
            
            const bind = {
                guestName,
                email: email || '',
                roomType,
                otp: checkinOtp,
                hotelName,
                checkInDate,
                checkOutDate,
                bookingId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
            };

            let connection;
            try {
                connection = await pool.getConnection();

                // --- AVAILABILITY CHECK ---
                // 1. Count Total Rooms
                const totalRoomsRes = await connection.execute(`SELECT count(*) as count FROM hms_rooms WHERE hotel_name = :hotelName AND room_type = :roomType`, { hotelName, roomType }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
                const totalRooms = totalRoomsRes.rows[0].COUNT;

                // 2. Count Active Guests (Occupied Now)
                const activeGuestsRes = await connection.execute(`SELECT count(*) as count FROM hms_guests g JOIN hms_rooms r ON g.room_number = r.room_number WHERE g.hotel_name = :hotelName AND r.room_type = :roomType`, { hotelName, roomType }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
                const activeGuests = activeGuestsRes.rows[0].COUNT;

                // 3. Count Future Confirmed Bookings overlapping with requested time
                const futureBookingsRes = await connection.execute(`SELECT count(*) as count FROM hms_online_bookings WHERE hotel_name = :hotelName AND room_type = :roomType AND booking_status = 'Confirmed' AND (check_in_time < :checkOutDate AND check_out_time > :checkInDate)`, { hotelName, roomType, checkOutDate, checkInDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
                const futureBookings = futureBookingsRes.rows[0].COUNT;

                if ((totalRooms - activeGuests - futureBookings) <= 0) {
                    return res.status(409).json({ message: 'Please select a different room or duration as the room is not available during the time period selected.' });
                }

                const result = await connection.execute(sql, bind, { autoCommit: true });
                const bookingId = result.outBinds.bookingId[0];

                // --- Send Confirmation Email Immediately ---
                if (email) {
                    const emailMsg = `Dear ${guestName},\n\nYour booking request for a ${roomType} at ${hotelName} has been received.\n\nCheck-in: ${checkInDate.toLocaleString()}\nDuration: ${duration} hours\n\nWe will review your request and send a verification code shortly.`;
                    const html = createEmailTemplate('Booking Received', `<p>Dear ${guestName},</p><p>Your booking request for a <strong>${roomType}</strong> at <strong>${hotelName}</strong> has been received.</p><p><strong>Check-in:</strong> ${checkInDate.toLocaleString()}<br><strong>Duration:</strong> ${duration} hours</p><p>We will review your request and send a verification code shortly.</p>`);
                    sendEmail(email, `Booking Received - ${hotelName}`, emailMsg, html).catch(console.error);
                }

                res.status(201).json({ 
                    message: 'Room confirmed successfully!', 
                    bookingId: bookingId 
                });
            } catch (err) {
                console.error("Online Booking Error:", err);
                res.status(500).json({ message: 'Failed to book room.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.get('/api/online-bookings', async (req, res) => {
            const { hotelName } = req.query;
            if (!hotelName || hotelName === 'null' || hotelName === 'undefined') {
                return res.json([]);
            }
            const sql = `SELECT booking_id, guest_name, email, room_type, booking_status, check_in_time, check_out_time 
                         FROM hms_online_bookings 
                         WHERE hotel_name = :hotelName AND booking_status IN ('Booked', 'Confirmed', 'Pending Payment') 
                         ORDER BY booking_id ASC`;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, { hotelName }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
                res.json(result.rows);
            } catch (err) {
                console.error("Get Online Bookings Error:", err);
                res.status(500).json({ message: 'Failed to fetch online bookings.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.post('/api/online-bookings/send-accept-otp', async (req, res) => {
            const { bookingId, hotelName } = req.body;
            let connection;
            try {
                connection = await pool.getConnection();
                const bookingResult = await connection.execute(
                    `SELECT email FROM hms_online_bookings WHERE booking_id = :bookingId AND hotel_name = :hotelName AND booking_status IN ('Booked', 'Pending Payment')`,
                    { bookingId, hotelName },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );

                if (bookingResult.rows.length === 0) {
                    return res.status(404).json({ message: 'Booking not found or already processed.' });
                }

                const booking = bookingResult.rows[0];
                const checkinOtp = Math.floor(100000 + Math.random() * 900000).toString();

                await connection.execute(
                    `UPDATE hms_online_bookings SET otp = :otp WHERE booking_id = :bookingId`,
                    { otp: checkinOtp, bookingId },
                    { autoCommit: true }
                );

                // Send OTP via Email
                if (booking.EMAIL) {
                    const message = `Your booking at <strong>${hotelName}</strong> has been accepted.<br>Your Verification OTP is: <strong>${checkinOtp}</strong><br><br>Please present this at the reception.`;
                    const html = createEmailTemplate('Booking Accepted', `<p>${message}</p>`);
                    await sendEmail(booking.EMAIL, 'Booking Accepted - Verify Check-in', 
                        `Your booking at ${hotelName} has been accepted.\nYour Verification OTP is: ${checkinOtp}\n\nPlease present this at the reception.`, html);
                } else {
                    console.log(`\n--- ⚠️ No email found for booking #${bookingId}. OTP is: ${checkinOtp} ---\n`);
                }
                
                res.json({ message: 'OTP has been sent to the guest for verification.' });

            } catch (err) {
                console.error("Send Acceptance OTP Error:", err);
                res.status(500).json({ message: 'Failed to send acceptance OTP.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.post('/api/online-bookings/confirm', async (req, res) => {
            const { bookingId, guestOtp, hotelName, age, gender, verificationIdType, verificationId, mobile, address } = req.body;
            let connection;
            try {
                connection = await pool.getConnection();

                // 1. Verify OTP
                const bookingResult = await connection.execute( // This query doesn't need country_code, it's just for verification
                    `SELECT guest_name, email, room_type, otp FROM hms_online_bookings 
                     WHERE booking_id = :bookingId AND hotel_name = :hotelName AND booking_status IN ('Booked', 'Confirmed', 'Pending Payment')`,
                    { bookingId, hotelName },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );

                if (bookingResult.rows.length === 0) {
                    return res.status(404).json({ message: 'Booking not found or already confirmed.' });
                }
                
                const booking = bookingResult.rows[0];
                if (booking.OTP !== guestOtp) {
                    return res.status(400).json({ message: 'Invalid OTP provided.' });
                }

                // 2. Find an available room of the booked type
                const availableRoomResult = await connection.execute(
                    `SELECT room_number FROM hms_rooms 
                     WHERE hotel_name = :hotelName AND room_type = :roomType 
                     AND room_number NOT IN (SELECT room_number FROM hms_guests WHERE hotel_name = :hotelName)`,
                    { hotelName, roomType: booking.ROOM_TYPE },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );

                if (availableRoomResult.rows.length === 0) {
                    return res.status(409).json({ message: `No available rooms of type '${booking.ROOM_TYPE}'.` });
                }
                const assignedRoom = availableRoomResult.rows[0].ROOM_NUMBER;

                // 3. Check-in the guest (add to hms_guests)
                // We don't have country code from the booking table, so we need to fetch it.
                const bookingDetails = await connection.execute(
                    `SELECT email FROM hms_online_bookings WHERE booking_id = :bookingId AND hotel_name = :hotelName`, 
                    { bookingId, hotelName }, 
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                const checkInSql = `INSERT INTO hms_guests (guest_name, country_code, mobile_number, email, room_number, check_in_time, hotel_name, gender, age, address, verification_id_type, verification_id) 
                                    VALUES (:name, :countryCode, :mobile, :email, :room, :checkIn, :hotel, :gender, :age, :address, :verificationIdType, :verificationId)`;
                
                await connection.execute(checkInSql, {
                    name: booking.GUEST_NAME,
                    countryCode: '+91', // Defaulting to +91 as UI sends combined or raw mobile
                    mobile: mobile || '0000000000',
                    email: bookingDetails.rows[0].EMAIL,
                    room: assignedRoom,
                    checkIn: new Date(),
                    hotel: hotelName,
                    gender: gender,
                    age: age,
                    address: address || 'Online Booking',
                    verificationIdType: verificationIdType,
                    verificationId: verificationId
                });
                
                // 4. Update the online booking status to 'Confirmed'
                await connection.execute(
                    `UPDATE hms_online_bookings SET booking_status = 'CheckedIn' WHERE booking_id = :bookingId`,
                    { bookingId }
                );

                await connection.commit();

                // Send Welcome Email
                const guestEmail = bookingDetails.rows[0].EMAIL;
                if (guestEmail) {
                    const html = createEmailTemplate('Check-in Successful', `<p>Dear ${booking.GUEST_NAME},</p><p>Welcome to <strong>${hotelName}</strong>!</p><p>Your booking is confirmed and you have checked into <strong>Room ${assignedRoom}</strong>.</p><p>We hope you have a pleasant stay.</p>`);
                    sendEmail(guestEmail, `Welcome to ${hotelName}`, `Welcome! You are in Room ${assignedRoom}.`, html).catch(console.error);
                }

                res.json({ message: `Booking confirmed! Guest ${booking.GUEST_NAME} checked into Room ${assignedRoom}.` });

            } catch (err) {
                console.error("Confirm Booking Error:", err);
                if (connection) await connection.rollback();
                res.status(500).json({ message: 'Failed to confirm booking: ' + err.message });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.post('/api/online-bookings/decline', async (req, res) => {
            const { bookingId, hotelName, reason } = req.body;
            let connection;
            try {
                connection = await pool.getConnection();

                // 1. Get guest's mobile number for notification
                const bookingResult = await connection.execute(
                    `SELECT email FROM hms_online_bookings 
                     WHERE booking_id = :bookingId AND hotel_name = :hotelName AND booking_status IN ('Booked', 'Confirmed', 'Pending Payment')`,
                    { bookingId, hotelName },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );

                if (bookingResult.rows.length === 0) {
                    return res.status(404).json({ message: 'Booking not found or already processed.' });
                }
                const booking = bookingResult.rows[0];

                // 2. Update the booking status to 'Declined'
                await connection.execute(
                    `UPDATE hms_online_bookings SET booking_status = 'Declined' WHERE booking_id = :bookingId`,
                    { bookingId }, 
                    { autoCommit: true }
                );

                // 3. Send a notification to the guest (simulated via console log)
                const declineMessage = `We regret to inform you that your booking (ID: ${bookingId}) with ${hotelName} has been declined.${reason ? '<br><br><strong>Reason:</strong> ' + reason : ''}`;
                
                // Send Email Notification
                const guestEmailResult = await connection.execute(`SELECT email FROM hms_online_bookings WHERE booking_id = :bookingId`, {bookingId}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
                if (guestEmailResult.rows.length > 0 && guestEmailResult.rows[0].EMAIL) {
                    const html = createEmailTemplate('Booking Update', `<p>${declineMessage}</p>`);
                    await sendEmail(guestEmailResult.rows[0].EMAIL, 'Booking Update', declineMessage, html);
                }

                res.json({ message: `Booking #${bookingId} has been declined and the guest notified.` });
            } catch (err) {
                console.error("Decline Booking Error:", err);
                res.status(500).json({ message: 'Failed to decline booking.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // --- Mark Booking as Pending Payment ---
        app.post('/api/online-bookings/mark-pending', async (req, res) => {
            const { bookingId, hotelName } = req.body;
            let connection;
            try {
                connection = await pool.getConnection();
                await connection.execute(
                    `UPDATE hms_online_bookings SET booking_status = 'Pending Payment', updated_at = CURRENT_TIMESTAMP WHERE booking_id = :bookingId AND hotel_name = :hotelName`,
                    { bookingId, hotelName }, { autoCommit: true }
                );
                res.json({ message: 'Booking marked as Pending Payment.' });
            } catch (err) {
                console.error("Mark Pending Error:", err);
                res.status(500).json({ message: 'Failed to update status.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // --- Mark Booking as Payment Received ---
        app.post('/api/online-bookings/payment-received', async (req, res) => {
            const { bookingId, hotelName } = req.body;
            let connection;
            try {
                connection = await pool.getConnection();
                await connection.execute(
                    `UPDATE hms_online_bookings SET booking_status = 'Booked', updated_at = CURRENT_TIMESTAMP WHERE booking_id = :bookingId AND hotel_name = :hotelName`,
                    { bookingId, hotelName }, { autoCommit: true }
                );
                res.json({ message: 'Payment recorded. Booking is now ready for acceptance.' });
            } catch (err) {
                console.error("Payment Received Error:", err);
                res.status(500).json({ message: 'Failed to update status.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.get('/api/hotels/availability', async (req, res) => {
            const { hotelName } = req.query;
            if (!hotelName) {
                return res.status(400).json({ message: 'Hotel name is required.' });
            }
        
            let connection;
            try {
                connection = await pool.getConnection();
        
                // Get all rooms for the hotel
                const roomsResult = await connection.execute(
                    `SELECT room_number, room_type, photos FROM hms_rooms WHERE hotel_name = :hotelName`,
                    { hotelName },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
        
                // Get all occupied rooms for the hotel
                const occupiedRoomsResult = await connection.execute(
                    `SELECT room_number FROM hms_guests WHERE hotel_name = :hotelName`,
                    { hotelName },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                const occupiedRoomNumbers = new Set(occupiedRoomsResult.rows.map(r => r.ROOM_NUMBER));
        
                // Filter for available rooms
                const availableRooms = roomsResult.rows.filter(room => !occupiedRoomNumbers.has(room.ROOM_NUMBER));
        
                res.json(availableRooms);
            } catch (err) {
                console.error("Get Availability Error:", err);
                res.status(500).json({ message: 'Failed to fetch room availability.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // --- Get Hotel Photos (Aggregated from Rooms) ---
        app.get('/api/hotels/:hotelName/photos', async (req, res) => {
            const { hotelName } = req.params;
            let connection;
            try {
                connection = await pool.getConnection();
                // Fetch photos from all rooms in this hotel
                const result = await connection.execute(
                    `SELECT photos FROM hms_rooms WHERE hotel_name = :hotelName AND photos IS NOT NULL`,
                    { hotelName },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                
                let allPhotos = [];
                result.rows.forEach(row => {
                    try {
                        const p = JSON.parse(row.PHOTOS);
                        if (Array.isArray(p)) allPhotos.push(...p);
                    } catch (e) {}
                });

                // Return a random subset (e.g., max 10) to avoid overloading
                const shuffled = allPhotos.sort(() => 0.5 - Math.random()).slice(0, 10);
                res.json(shuffled);
            } catch (err) {
                console.error("Get Hotel Photos Error:", err);
                res.status(500).json({ message: 'Failed to fetch hotel photos.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // New endpoint for sending OTP during manual check-in
        app.post('/api/guest/send-checkin-otp', async (req, res) => {
            const { email } = req.body;
            console.log(`Request to send check-in OTP to: ${email}`);
            if (!email) {
                return res.status(400).json({ message: 'Email is required for OTP.' });
            }
            
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            // Store OTP mapped to email (or mobile if you prefer, but email is safer for this flow)
            // For simplicity in this hybrid flow, we'll map it to the email string in the store
            otpStore[email] = { otp, timestamp: Date.now() };

            const html = createEmailTemplate('Check-in Verification', `<p>Your check-in OTP is:</p><h2 style="color: #007bff; text-align: center; letter-spacing: 5px;">${otp}</h2>`);
            await sendEmail(email, 'Check-in Verification', `Your check-in OTP is: ${otp}`, html);
            res.json({ message: 'OTP sent to email.' });
        });

        // --- Hotel List Route ---
        app.get('/api/hotels', async (req, res) => {
            // Fetches a distinct list of hotel names from the users table.
            const sql = `SELECT DISTINCT hotel_name FROM hms_users WHERE hotel_name IS NOT NULL ORDER BY hotel_name`;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
                const hotelNames = result.rows.map(row => row.HOTEL_NAME);
                res.json(hotelNames);
            } catch (err) {
                console.error("Get Hotels Error:", err);
                res.status(500).json({ message: 'Failed to fetch hotel list.' });
            } finally {
                if (connection) await connection.close();
            }
        });


        // --- User Routes ---
        app.post('/api/register', async (req, res) => {
            const { fullName, email, mobile, role, address, hotelName } = req.body;
            
            if (!fullName || !role || !hotelName) {
                return res.status(400).json({ message: 'Name, Role and Hotel are required.' });
            }

            // For Room accounts, email and mobile are optional
            const finalEmail = (role === 'Room' && !email) ? `room_${fullName.replace(/\s+/g, '')}@internal` : email;
            const finalMobile = (role === 'Room' && !mobile) ? '0000000000' : mobile;

            if (role !== 'Room' && (!email || !mobile)) {
                return res.status(400).json({ message: 'Email and Mobile are required for staff accounts.' });
            }
            
            // Auto-generate credentials
            const cleanName = fullName.replace(/\s+/g, '').toLowerCase();
            // Generate username using name and last 4 digits of mobile number
            const mobileSuffix = finalMobile !== '0000000000' ? finalMobile.slice(-4) : Math.floor(1000 + Math.random() * 9000);
            const username = `${cleanName}${mobileSuffix}`;
            const tempPassword = Math.random().toString(36).slice(-8); // 8 char random string

            const sql = `INSERT INTO hms_users (full_name, username, password, email, mobile_number, role, address, hotel_name, perm_manage_rooms, perm_add_guests, perm_edit_guests, hotel_slug) 
                         VALUES (:fullName, :username, :password, :email, :mobile, :role, :address, :hotelName, 0, 0, 0, :hotelSlug)`;
            let connection;
            try {
                connection = await pool.getConnection();
                
                // Generate unique slug for Owners
                let hotelSlug = null;
                if (role === 'Owner' && hotelName) {
                    hotelSlug = await generateUniqueSlug(hotelName, connection);
                }

                await connection.execute(sql, {
                    fullName,
                    username,
                    password: tempPassword,
                    email: finalEmail,
                    mobile: finalMobile,
                    role,
                    address: address || '',
                    hotelName,
                    hotelSlug
                }, { autoCommit: true });

                if (email && role !== 'Room') {
                    // Generate a reset token for the new user to set their own password immediately if they want
                    const token = Math.random().toString(36).substring(2);
                    resetTokenStore[username] = { token, timestamp: Date.now() };
                    const resetLink = `http://localhost:3000/reset-password.html?user=${username}&token=${token}`;

                    const html = createEmailTemplate('Welcome to HMS', `<p>Hello ${fullName},</p><p>Your account has been created.</p><p><strong>Username:</strong> ${username}<br><strong>Temporary Password:</strong> ${tempPassword}</p><p>You can login with the temporary password or click the link below to set a new one:</p><p><a href="${resetLink}" style="background:#007bff;color:white;padding:10px 15px;text-decoration:none;border-radius:5px;">Reset Password</a></p>`);
                    await sendEmail(email, 'Welcome to HMS - Account Details', `Username: ${username}\nTemp Password: ${tempPassword}\nReset Link: ${resetLink}`, html);
                }

                res.status(201).json({ message: 'User registered successfully!' });
            } catch (err) {
                console.error("Registration Error:", err);
                if (err.errorNum === 1) {
                    res.status(409).json({ message: 'Username already exists.' });
                } else if (err.errorNum === 904) {
                    console.error("❌ Database Error: Missing column. Please run: ALTER TABLE hms_users ADD mobile_number VARCHAR2(20);");
                    res.status(500).json({ message: 'Server Error: Database schema is outdated (missing mobile_number).' });
                } else {
                    res.status(500).json({ message: 'Registration failed: ' + err.message });
                }
            } finally {
                if (connection) {
                    try {
                        await connection.close();
                    } catch (err) {
                        console.error("Error closing connection:", err);
                    }
                }
            }
        });

        app.post('/api/login', async (req, res) => {
            const { username, password } = req.body;
            
            console.log("Login attempt for username:", username);
            
            if (!username || !password) {
                return res.status(400).json({ message: 'Username and password are required.' });
            }
            
            const sql = `SELECT user_id, full_name, username, role, address, hotel_name, email, mobile_number, profile_picture, perm_manage_rooms, perm_add_guests, perm_edit_guests, is_dark_mode, notification_volume, notification_sound, last_read_broadcast, read_notifications 
                         FROM hms_users WHERE username = :username AND password = :password`;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, { username, password }, { 
                    outFormat: oracledb.OUT_FORMAT_OBJECT,
                    fetchInfo: { PROFILE_PICTURE: { type: oracledb.STRING }, NOTIFICATION_SOUND: { type: oracledb.STRING }, READ_NOTIFICATIONS: { type: oracledb.STRING } }
                });
                
                if (result.rows.length > 0) {
                    const dbUser = result.rows[0];
                    const user = {
                        userId: dbUser.USER_ID,
                        fullName: dbUser.FULL_NAME,
                        username: dbUser.USERNAME,
                        role: dbUser.ROLE,
                        address: dbUser.ADDRESS,
                        hotelName: dbUser.HOTEL_NAME,
                        email: dbUser.EMAIL,
                        mobile: dbUser.MOBILE_NUMBER,
                        profilePicture: dbUser.PROFILE_PICTURE,
                        permissions: {
                            manageRooms: dbUser.PERM_MANAGE_ROOMS === 1,
                            addGuests: dbUser.PERM_ADD_GUESTS === 1,
                            editGuests: dbUser.PERM_EDIT_GUESTS === 1
                        },
                        isDarkMode: dbUser.IS_DARK_MODE === 1,
                        notificationVolume: dbUser.NOTIFICATION_VOLUME !== null ? dbUser.NOTIFICATION_VOLUME : 1.0,
                        notificationSound: dbUser.NOTIFICATION_SOUND,
                        lastReadBroadcast: dbUser.LAST_READ_BROADCAST,
                        readNotifications: dbUser.READ_NOTIFICATIONS
                    };
                    console.log("Login successful for:", username);
                    res.json(user);
                } else {
                    console.log("Invalid credentials for:", username);
                    res.status(401).json({ message: 'Invalid username or password.' });
                }
            } catch (err) {
                console.error("Login Error:", err);
                res.status(500).json({ message: 'Server error during login: ' + err.message });
            } finally {
                if (connection) {
                    try {
                        await connection.close();
                    } catch (err) {
                        console.error("Error closing connection:", err);
                    }
                }
            }
        });

        // --- Forgot Password & Reset Routes ---
        app.post('/api/auth/forgot-password-otp', async (req, res) => {
            const { email } = req.body;
            // Verify email exists in DB
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(`SELECT username FROM hms_users WHERE email = :email`, { email });
                if (result.rows.length === 0) {
                    return res.status(404).json({ message: 'No account registered with the entered email ID.' });
                }
                
                const otp = Math.floor(100000 + Math.random() * 900000).toString();
                otpStore['FORGOT_' + email] = { otp, timestamp: Date.now() };
                
                const html = createEmailTemplate('Password Reset OTP', `<p>Your OTP to reset password is:</p><h2>${otp}</h2>`);
                await sendEmail(email, 'HMS Password Reset OTP', `OTP: ${otp}`, html);
                
                res.json({ message: 'OTP sent to email.' });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: 'Error processing request.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.post('/api/auth/verify-forgot-otp', async (req, res) => {
            const { email, otp } = req.body;
            const key = 'FORGOT_' + email;
            const data = otpStore[key];
            
            if (data && data.otp === otp) {
                delete otpStore[key];
                
                // Get username to generate token
                let connection = await pool.getConnection();
                const result = await connection.execute(`SELECT username FROM hms_users WHERE email = :email`, { email });
                await connection.close();
                const username = result.rows[0][0]; // Array format default

                const token = Math.random().toString(36).substring(2);
                resetTokenStore[username] = { token, timestamp: Date.now() };
                
                const resetLink = `http://localhost:3000/reset-password.html?user=${username}&token=${token}`;
                const html = createEmailTemplate('Reset Password Link', `<p>Click the link below to reset your password:</p><p><a href="${resetLink}">Reset Password</a></p>`);
                await sendEmail(email, 'HMS Password Reset Link', `Link: ${resetLink}`, html);

                res.json({ message: 'OTP Verified. Reset link sent to email.' });
            } else {
                res.status(400).json({ message: 'Invalid OTP.' });
            }
        });

        app.post('/api/auth/reset-password', async (req, res) => {
            const { username, token, newPassword } = req.body;
            const data = resetTokenStore[username];
            
            if (data && data.token === token) {
                let connection = await pool.getConnection();
                await connection.execute(`UPDATE hms_users SET password = :pw WHERE username = :un`, { pw: newPassword, un: username }, { autoCommit: true });
                await connection.close();
                delete resetTokenStore[username];
                res.json({ message: 'Password updated successfully.' });
            } else {
                res.status(400).json({ message: 'Invalid or expired token.' });
            }
        });

        // --- Admin Routes ---
        // Reconnect Database Endpoint
        app.post('/api/admin/system-health/reconnect-db', async (req, res) => {
            const success = await initDb();
            if (success) {
                res.json({ message: 'Database connection established successfully.' });
            } else {
                res.status(500).json({ message: 'Failed to connect to database. Check server logs.' });
            }
        });

        // Helper to get all registered routes from Express
        function getRoutes(app) {
            const routes = [];
            if (app._router && app._router.stack) {
                app._router.stack.forEach((middleware) => {
                    if (middleware.route) { // routes registered directly on the app
                        if (Array.isArray(middleware.route.path)) {
                            middleware.route.path.forEach(p => {
                                if (typeof p === 'string') routes.push(p);
                            });
                        } else if (typeof middleware.route.path === 'string') {
                            routes.push(middleware.route.path);
                        }
                    } else if (middleware.name === 'router') { // router middleware 
                        middleware.handle.stack.forEach((handler) => {
                            if (handler.route) {
                                if (Array.isArray(handler.route.path)) {
                                    handler.route.path.forEach(p => {
                                        if (typeof p === 'string') routes.push(p);
                                    });
                                } else if (typeof handler.route.path === 'string') {
                                    routes.push(handler.route.path);
                                }
                            }
                        });
                    }
                });
            }
            return [...new Set(routes)];
        }

        // System Health Endpoint
        app.get('/api/admin/system-health', async (req, res) => {
            let dbStatus = 'Disconnected';
            let connection;
            try {
                if (pool) {
                    connection = await pool.getConnection();
                    await connection.execute('SELECT 1 FROM DUAL');
                    dbStatus = 'Connected';
                }
            } catch (err) {
                console.error("Health Check DB Error:", err);
                dbStatus = 'Error: ' + err.message;
            } finally {
                if (connection) {
                    try {
                        await connection.close();
                    } catch (e) {
                        console.error("Error closing health check connection", e);
                    }
                }
            }

            // Dynamic API Discovery: Find routes not covered by existing groups
            const allRoutes = getRoutes(app).filter(p => p.startsWith('/api/'));
            const coveredRoutes = new Set();
            Object.values(apiGroups).forEach(group => {
                group.paths.forEach(prefix => {
                    allRoutes.forEach(route => {
                        if (route.startsWith(prefix)) coveredRoutes.add(route);
                    });
                });
            });
            const uncovered = allRoutes.filter(r => !coveredRoutes.has(r));
            
            // Dynamically add any new/uncovered APIs to the list so they are visible
            uncovered.forEach(route => {
                const name = `API: ${route}`;
                if (!apiGroups[name]) {
                    apiGroups[name] = { enabled: true, paths: [route] };
                }
            });

            // Define subsystems status based on DB connection
            const subsystems = [
                { name: 'Authentication Module', status: dbStatus === 'Connected' ? 'Operational' : 'Degraded' },
                ...Object.keys(apiGroups).map(name => ({
                    name: name,
                    status: !apiEnabled ? 'Stopped (Global)' : (apiGroups[name].enabled ? (dbStatus === 'Connected' ? 'Operational' : 'Degraded') : 'Stopped')
                }))
            ];

            res.json({
                apiStatus: 'Running',
                dbStatus: dbStatus,
                uptime: process.uptime(),
                timestamp: new Date(),
                subsystems: subsystems
            });
        });

        // Get All Owners
        app.get('/api/admin/owners', async (req, res) => {
            const sql = `SELECT user_id, full_name, email, mobile_number, hotel_name, address, hotel_slug, upi_id FROM hms_users WHERE role = 'Owner' ORDER BY hotel_name`;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
                res.json(result.rows);
            } catch (err) {
                console.error("Get Owners Error:", err);
                res.status(500).json({ message: 'Failed to fetch owners.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // Regenerate Hotel Slug
        app.post('/api/admin/regenerate-slug', async (req, res) => {
            const { userId } = req.body;
            let connection;
            try {
                connection = await pool.getConnection();
                const userResult = await connection.execute(
                    `SELECT hotel_name FROM hms_users WHERE user_id = :userId`, 
                    { userId }, 
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                
                if (userResult.rows.length === 0) return res.status(404).json({ message: 'User not found' });
                
                const newSlug = await generateUniqueSlug(userResult.rows[0].HOTEL_NAME, connection, userId);
                await connection.execute(`UPDATE hms_users SET hotel_slug = :newSlug WHERE user_id = :userId`, { newSlug, userId }, { autoCommit: true });
                
                res.json({ message: 'Slug regenerated successfully.', newSlug });
            } catch (err) {
                console.error("Regenerate Slug Error:", err);
                res.status(500).json({ message: 'Failed to regenerate slug.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // Delete Owner
        app.delete('/api/admin/owners/:user_id', async (req, res) => {
            const { user_id } = req.params;
            let connection;
            try {
                connection = await pool.getConnection();
                
                // 1. Get the hotel name for this owner
                const ownerResult = await connection.execute(
                    `SELECT hotel_name FROM hms_users WHERE user_id = :user_id AND role = 'Owner'`,
                    { user_id },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );

                if (ownerResult.rows.length === 0) {
                    return res.status(404).json({ message: 'Owner not found.' });
                }

                const hotelName = ownerResult.rows[0].HOTEL_NAME;

                // 2. Delete all users associated with this hotel (including the owner)
                const result = await connection.execute(
                    `DELETE FROM hms_users WHERE hotel_name = :hotelName`,
                    { hotelName },
                    { autoCommit: true }
                );
                
                res.json({ message: `Owner and ${result.rowsAffected - 1} associated accounts deleted successfully.` });
            } catch (err) {
                console.error("Delete Owner Error:", err);
                res.status(500).json({ message: 'Failed to delete owner and associated accounts.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // Broadcast Message (Admin to Owners)
        app.post('/api/admin/broadcast', async (req, res) => {
            const { message } = req.body;
            if (!message) return res.status(400).json({ message: 'Message content is required.' });
            
            let connection;
            try {
                connection = await pool.getConnection();
                // Deactivate old messages so only the latest is shown
                await connection.execute(`UPDATE hms_broadcasts SET is_active = 0 WHERE hotel_name IS NULL`, {}, { autoCommit: false });
                
                // Insert new message
                await connection.execute(
                    `INSERT INTO hms_broadcasts (message, is_active, hotel_name) VALUES (:message, 1, NULL)`,
                    { message },
                    { autoCommit: true }
                );
                res.json({ message: 'Broadcast sent successfully.' });
            } catch (err) {
                console.error("Broadcast Error:", err);
                if (connection) await connection.rollback();
                res.status(500).json({ message: 'Failed to send broadcast.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.get('/api/broadcast', async (req, res) => {
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(
                    `SELECT message, created_at FROM hms_broadcasts WHERE is_active = 1 AND hotel_name IS NULL ORDER BY id DESC FETCH FIRST 1 ROWS ONLY`,
                    [],
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                if (result.rows.length > 0) {
                    res.json(result.rows[0]);
                } else {
                    res.json(null);
                }
            } catch (err) {
                console.error("Get Broadcast Error:", err);
                res.status(500).json({ message: 'Failed to fetch broadcast.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // Owner Broadcast (Owner to Staff)
        app.post('/api/owner/broadcast', async (req, res) => {
            const { message, hotelName } = req.body;
            if (!message || !hotelName) return res.status(400).json({ message: 'Message and Hotel Name are required.' });
            
            let connection;
            try {
                connection = await pool.getConnection();
                // Deactivate old messages for this hotel
                await connection.execute(`UPDATE hms_broadcasts SET is_active = 0 WHERE hotel_name = :hotelName`, { hotelName }, { autoCommit: false });
                
                // Insert new message
                await connection.execute(
                    `INSERT INTO hms_broadcasts (message, is_active, hotel_name) VALUES (:message, 1, :hotelName)`,
                    { message, hotelName },
                    { autoCommit: true }
                );
                res.json({ message: 'Broadcast sent to staff successfully.' });
            } catch (err) {
                console.error("Owner Broadcast Error:", err);
                if (connection) await connection.rollback();
                res.status(500).json({ message: 'Failed to send broadcast.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.get('/api/hotel/broadcast', async (req, res) => {
            const { hotelName } = req.query;
            if (!hotelName) return res.json(null);

            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(
                    `SELECT message, created_at FROM hms_broadcasts WHERE hotel_name = :hotelName AND is_active = 1 ORDER BY id DESC FETCH FIRST 1 ROWS ONLY`,
                    { hotelName },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                if (result.rows.length > 0) {
                    res.json(result.rows[0]);
                } else {
                    res.json(null);
                }
            } catch (err) {
                console.error("Get Hotel Broadcast Error:", err);
                res.status(500).json({ message: 'Failed to fetch broadcast.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // --- Backup & Restore Routes ---
        app.get('/api/admin/backup', async (req, res) => {
            let connection;
            try {
                connection = await pool.getConnection();
                const tables = ['HMS_USERS', 'HMS_ROOMS', 'HMS_GUESTS', 'HMS_ONLINE_BOOKINGS', 'HMS_BILL_HISTORY', 'FOOD_MENU', 'FOOD_ORDERS', 'SERVICE_REQUESTS', 'HMS_BROADCASTS'];
                const backupData = {};

                for (const table of tables) {
                    // Fetch all data
                    const result = await connection.execute(`SELECT * FROM ${table}`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
                    backupData[table] = result.rows;
                }

                res.json(backupData);
            } catch (err) {
                console.error("Backup failed:", err);
                res.status(500).json({ message: "Backup failed." });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.post('/api/admin/restore', async (req, res) => {
            const backupData = req.body;
            if (!backupData || Object.keys(backupData).length === 0) {
                return res.status(400).json({ message: "Invalid backup data." });
            }

            let connection;
            try {
                connection = await pool.getConnection();
                
                // Order matters for Foreign Keys: Delete children first, Insert parents first
                const deleteOrder = ['FOOD_ORDERS', 'HMS_BILL_HISTORY', 'HMS_GUESTS', 'HMS_ONLINE_BOOKINGS', 'SERVICE_REQUESTS', 'HMS_ROOMS', 'FOOD_MENU', 'HMS_BROADCASTS', 'HMS_USERS'];
                const insertOrder = ['HMS_USERS', 'HMS_ROOMS', 'FOOD_MENU', 'HMS_BROADCASTS', 'HMS_ONLINE_BOOKINGS', 'HMS_GUESTS', 'HMS_BILL_HISTORY', 'FOOD_ORDERS', 'SERVICE_REQUESTS'];

                // 1. Clear Data
                for (const table of deleteOrder) {
                    try { await connection.execute(`DELETE FROM ${table}`); } catch(e) { console.log(`Warning clearing ${table}: ${e.message}`); }
                }

                // 2. Insert Data
                for (const table of insertOrder) {
                    const rows = backupData[table];
                    if (rows && rows.length > 0) {
                        const columns = Object.keys(rows[0]);
                        // Create :0, :1, :2 placeholders
                        const placeholders = columns.map((_, i) => `:${i}`).join(', ');
                        const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
                        
                        const binds = rows.map(row => {
                            return columns.map(col => {
                                const val = row[col];
                                // Convert ISO date strings back to Date objects for Oracle
                                if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) return new Date(val);
                                return val;
                            });
                        });

                        await connection.executeMany(sql, binds, { autoCommit: false });
                    }
                }

                await connection.commit();
                res.json({ message: "Database restored successfully." });
            } catch (err) {
                console.error("Restore failed:", err);
                if (connection) await connection.rollback();
                res.status(500).json({ message: "Restore failed: " + err.message });
            } finally {
                if (connection) await connection.close();
            }
        });

        // --- Global Search & Notifications ---

        app.get('/api/notifications', async (req, res) => {
            const { role, hotelName } = req.query;
            let connection;
            try {
                connection = await pool.getConnection();
                let notifications = [];

                if (role === 'Admin') {
                    // Admin sees new bookings from all hotels
                    const result = await connection.execute(
                        `SELECT 'New Booking' as title, guest_name || ' (' || hotel_name || ')' as message, booking_id as id
                         FROM hms_online_bookings WHERE booking_status = 'Booked' ORDER BY booking_id DESC FETCH FIRST 10 ROWS ONLY`,
                        [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
                    );
                    notifications = result.rows;
                } else if (role === 'Owner' || role === 'Manager') {
                    // Owner sees new bookings for their hotel
                    if (hotelName) {
                        const result = await connection.execute(
                            `SELECT 'New Booking' as title, guest_name as message, booking_id as id
                             FROM hms_online_bookings WHERE hotel_name = :hotelName AND booking_status = 'Booked' ORDER BY booking_id DESC FETCH FIRST 10 ROWS ONLY`,
                            { hotelName }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
                        );
                        notifications = result.rows;
                    }
                } else if (role === 'Chef') {
                    // Chef sees Pending food orders
                    if (hotelName) {
                        const result = await connection.execute(
                            `SELECT 'New Order' as title, 'Room ' || room_number as message, id
                             FROM food_orders WHERE hotel_name = :hotelName AND status = 'Pending' ORDER BY created_at DESC FETCH FIRST 10 ROWS ONLY`,
                            { hotelName }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
                        );
                        notifications = result.rows;
                    }
                } else if (role === 'Waiter') {
                    // Waiter sees Prepared food orders
                    if (hotelName) {
                        const result = await connection.execute(
                            `SELECT 'Order Ready' as title, 'Room ' || room_number as message, id
                             FROM food_orders WHERE hotel_name = :hotelName AND status = 'Prepared' ORDER BY created_at DESC FETCH FIRST 10 ROWS ONLY`,
                            { hotelName }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
                        );
                        notifications = result.rows;
                    }
                } else if (role === 'Housekeeping') {
                    // Housekeeping sees Pending service requests
                    if (hotelName) {
                         const result = await connection.execute(
                            `SELECT 'Service Request' as title, 'Room ' || room_number || ': ' || request_type as message, id
                             FROM service_requests WHERE hotel_name = :hotelName AND status = 'Pending' ORDER BY created_at DESC FETCH FIRST 10 ROWS ONLY`,
                            { hotelName }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
                        );
                        notifications = result.rows;
                    }
                }

                res.json(notifications);
            } catch (err) {
                console.error("Notification Error:", err);
                res.status(500).json({ message: 'Failed to fetch notifications.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // --- Resolve Hotel Slug ---
        app.get('/api/resolve-slug/:slug', async (req, res) => {
            const { slug } = req.params;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(
                    `SELECT hotel_name, profile_picture FROM hms_users WHERE hotel_slug = :slug AND role = 'Owner'`,
                    { slug },
                    { 
                        outFormat: oracledb.OUT_FORMAT_OBJECT,
                        fetchInfo: { PROFILE_PICTURE: { type: oracledb.STRING } }
                    }
                );
                if (result.rows.length > 0) {
                    res.json({ hotelName: result.rows[0].HOTEL_NAME, logo: result.rows[0].PROFILE_PICTURE });
                } else {
                    res.status(404).json({ message: 'Hotel not found' });
                }
            } catch (err) {
                console.error("Resolve Slug Error:", err);
                res.status(500).json({ message: 'Server error' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.get('/api/users', async (req, res) => {
            const { hotelName } = req.query;
            if (!hotelName || hotelName === 'null' || hotelName === 'undefined') {
                return res.json([]);
            }
            const sql = `SELECT user_id, full_name, username, email, mobile_number, role, address, hotel_name, perm_manage_rooms, perm_add_guests, perm_edit_guests 
                         FROM hms_users WHERE role != 'Owner' AND hotel_name = :hotelName ORDER BY full_name`;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, { hotelName }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
                res.json(result.rows);
            } catch (err) {
                console.error("Get Users Error:", err);
                res.status(500).json({ message: 'Failed to fetch users.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.get('/api/users/:username', async (req, res) => {
            const { username } = req.params;
            const sql = `SELECT u.user_id, u.full_name, u.username, u.role, u.address, u.hotel_name, u.email, u.mobile_number, u.profile_picture, u.perm_manage_rooms, u.perm_add_guests, u.perm_edit_guests, u.is_dark_mode, u.notification_volume, u.notification_sound, u.last_read_broadcast, u.read_notifications,
                                m.full_name as reports_to_name
                         FROM hms_users u
                         LEFT JOIN hms_employee_details d ON u.user_id = d.user_id
                         LEFT JOIN hms_users m ON d.reports_to = m.user_id
                         WHERE u.username = :username`;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, { username }, { 
                    outFormat: oracledb.OUT_FORMAT_OBJECT,
                    fetchInfo: { PROFILE_PICTURE: { type: oracledb.STRING }, NOTIFICATION_SOUND: { type: oracledb.STRING }, READ_NOTIFICATIONS: { type: oracledb.STRING } }
                });
                
                if (result.rows.length > 0) {
                    const dbUser = result.rows[0];
                    const user = {
                        userId: dbUser.USER_ID,
                        fullName: dbUser.FULL_NAME,
                        username: dbUser.USERNAME,
                        role: dbUser.ROLE,
                        address: dbUser.ADDRESS,
                        hotelName: dbUser.HOTEL_NAME,
                        email: dbUser.EMAIL,
                        mobile: dbUser.MOBILE_NUMBER,
                        profilePicture: dbUser.PROFILE_PICTURE,
                        permissions: {
                            manageRooms: dbUser.PERM_MANAGE_ROOMS === 1,
                            addGuests: dbUser.PERM_ADD_GUESTS === 1,
                            editGuests: dbUser.PERM_EDIT_GUESTS === 1
                        },
                        isDarkMode: dbUser.IS_DARK_MODE === 1,
                        notificationVolume: dbUser.NOTIFICATION_VOLUME !== null ? dbUser.NOTIFICATION_VOLUME : 1.0,
                        notificationSound: dbUser.NOTIFICATION_SOUND,
                        lastReadBroadcast: dbUser.LAST_READ_BROADCAST,
                        readNotifications: dbUser.READ_NOTIFICATIONS,
                        reportsToName: dbUser.REPORTS_TO_NAME
                    };
                    res.json(user);
                } else {
                    res.status(404).json({ message: 'User not found.' });
                }
            } catch (err) {
                console.error("Get User Profile Error:", err);
                res.status(500).json({ message: 'Failed to fetch user profile.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // Get Owner Name for a Hotel
        app.get('/api/hotel/owner', async (req, res) => {
            const { hotelName } = req.query;
            const sql = `SELECT full_name FROM hms_users WHERE hotel_name = :hotelName AND role = 'Owner' FETCH FIRST 1 ROWS ONLY`;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, { hotelName }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
                if (result.rows.length > 0) {
                    res.json({ ownerName: result.rows[0].FULL_NAME });
                } else {
                    res.json({ ownerName: 'Hotel Owner' });
                }
            } catch (err) {
                console.error("Get Owner Error:", err);
                res.status(500).json({ message: 'Failed to fetch owner details.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // Update User Details (Profile Picture, Personal Info)
        app.put('/api/users/:user_id', async (req, res) => {
            const { user_id } = req.params;
            const { fullName, email, mobile, address, role, profilePicture, isDarkMode, notificationVolume, notificationSound, lastReadBroadcast, readNotifications, featureScrollSpeed, upiId, themeColor } = req.body;
            
            // Build dynamic query based on provided fields
            let updates = [];
            const binds = { user_id };

            if (fullName) { updates.push("full_name = :fullName"); binds.fullName = fullName; }
            if (email) { updates.push("email = :email"); binds.email = email; }
            if (mobile) { updates.push("mobile_number = :mobile"); binds.mobile = mobile; }
            if (address) { updates.push("address = :address"); binds.address = address; }
            if (role) { updates.push("role = :role"); binds.role = role; }
            if (profilePicture !== undefined) { updates.push("profile_picture = :profilePicture"); binds.profilePicture = profilePicture; }
            if (isDarkMode !== undefined) { updates.push("is_dark_mode = :isDarkMode"); binds.isDarkMode = isDarkMode ? 1 : 0; }
            if (notificationVolume !== undefined) { updates.push("notification_volume = :notificationVolume"); binds.notificationVolume = notificationVolume; }
            if (notificationSound !== undefined) { updates.push("notification_sound = :notificationSound"); binds.notificationSound = notificationSound; }
            if (lastReadBroadcast !== undefined) { updates.push("last_read_broadcast = :lastReadBroadcast"); binds.lastReadBroadcast = lastReadBroadcast; }
            if (readNotifications !== undefined) { updates.push("read_notifications = :readNotifications"); binds.readNotifications = readNotifications; }
            if (featureScrollSpeed !== undefined) { updates.push("feature_scroll_speed = :featureScrollSpeed"); binds.featureScrollSpeed = featureScrollSpeed; }
            if (upiId !== undefined) { updates.push("upi_id = :upiId"); binds.upiId = upiId; }
            if (themeColor !== undefined) { updates.push("theme_color = :themeColor"); binds.themeColor = themeColor; }

            if (updates.length === 0) return res.status(400).json({ message: "No fields to update." });

            const sql = `UPDATE hms_users SET ${updates.join(', ')} WHERE user_id = :user_id`;
            
            let connection;
            try {
                connection = await pool.getConnection();
                await connection.execute(sql, binds, { autoCommit: true });
                res.json({ message: 'User details updated successfully.' });
            } catch (err) {
                console.error("Update User Error:", err);
                res.status(500).json({ message: 'Failed to update user details.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.delete('/api/users/:user_id', async (req, res) => {
            const { user_id } = req.params;
            const sql = `DELETE FROM hms_users WHERE user_id = :user_id AND role != 'Owner'`;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, { user_id }, { autoCommit: true });
                if (result.rowsAffected === 0) {
                    res.status(404).json({ message: 'User not found or cannot be deleted.' });
                } else {
                    res.json({ message: 'User deleted successfully.' });
                }
            } catch (err) {
                console.error("Delete User Error:", err);
                res.status(500).json({ message: 'Failed to delete user.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.post('/api/users/change-password', async (req, res) => {
            const { username, currentPassword, newPassword } = req.body;
            
            if (!username || !currentPassword || !newPassword) {
                return res.status(400).json({ message: 'All fields are required.' });
            }

            let connection;
            try {
                connection = await pool.getConnection();
                
                // Verify current password
                const checkSql = `SELECT user_id FROM hms_users WHERE username = :username AND password = :currentPassword`;
                const checkResult = await connection.execute(checkSql, { username, currentPassword });
                
                if (checkResult.rows.length === 0) {
                    return res.status(401).json({ message: 'Incorrect current password.' });
                }

                // Update password
                const updateSql = `UPDATE hms_users SET password = :newPassword WHERE username = :username`;
                await connection.execute(updateSql, { newPassword, username }, { autoCommit: true });
                
                res.json({ message: 'Password updated successfully.' });
            } catch (err) {
                console.error("Change Password Error:", err);
                res.status(500).json({ message: 'Failed to update password.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // FIXED: Rewritten permission update endpoint for correctness and security
        const permissionColumnMap = {
            manageRooms: 'PERM_MANAGE_ROOMS',
            addGuests: 'PERM_ADD_GUESTS',
            editGuests: 'PERM_EDIT_GUESTS'
        };

        app.put('/api/users/:user_id/permissions', async (req, res) => {
            const user_id = parseInt(req.params.user_id, 10);
            const permissionKey = Object.keys(req.body)[0];
            const permissionValue = req.body[permissionKey];

            if (!permissionKey || !permissionColumnMap[permissionKey]) {
                return res.status(400).json({ message: 'Invalid permission key provided.' });
            }

            const dbColumn = permissionColumnMap[permissionKey];
            const dbValue = permissionValue ? 1 : 0;

            const sql = `UPDATE hms_users SET ${dbColumn} = :dbValue WHERE user_id = :user_id`;
            
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, {
                    dbValue,
                    user_id
                }, { autoCommit: true });

                if (result.rowsAffected === 0) {
                    return res.status(404).json({ message: 'User not found.' });
                }

                res.json({ message: 'Permission updated successfully.' });
            } catch (err) {
                console.error("Update Permission Error:", err);
                res.status(500).json({ message: 'Failed to update permissions.' });
            } finally {
                if (connection) await connection.close();
            }
        });
        
        // --- Room Routes ---
        app.get('/api/rooms', async (req, res) => {
            const { hotelName } = req.query;
            if (!hotelName || hotelName === 'null' || hotelName === 'undefined') {
                return res.json([]);
            }
            // OPTIMIZATION: Exclude 'photos' column from the list view to reduce payload size significantly
            const sql = `SELECT room_id, room_type, room_number, cost_per_hour, cost_per_day, discount_percent FROM hms_rooms WHERE hotel_name = :hotelName ORDER BY room_number`;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, { hotelName }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
                res.json(result.rows);
            } catch (err) {
                console.error("Get Rooms Error:", err);
                res.status(500).json({ message: 'Failed to fetch rooms.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // New Endpoint: Get Single Room Details (including photos)
        app.get('/api/rooms/:room_number', async (req, res) => {
            const { room_number } = req.params;
            const { hotelName } = req.query;
            const sql = `SELECT * FROM hms_rooms WHERE room_number = :room_number AND hotel_name = :hotelName`;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, { room_number, hotelName }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
                if (result.rows.length > 0) {
                    res.json(result.rows[0]);
                } else {
                    res.status(404).json({ message: 'Room not found.' });
                }
            } catch (err) {
                console.error("Get Room Details Error:", err);
                res.status(500).json({ message: 'Failed to fetch room details.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.post('/api/rooms', async (req, res) => {
            const { type, number, costHour, costDay, discount, hotelName, photos } = req.body;
            const sql = `INSERT INTO hms_rooms (room_type, room_number, cost_per_hour, cost_per_day, discount_percent, hotel_name, photos) 
                         VALUES (:roomType, :roomNumber, :costHour, :costDay, :discount, :hotelName, :photos)`;
            let connection;
            try {
                connection = await pool.getConnection();
                await connection.execute(sql, {
                    roomType: type,
                    roomNumber: number,
                    costHour: costHour,
                    costDay: costDay,
                    discount: discount || 0,
                    hotelName: hotelName,
                    photos: photos || null
                }, { autoCommit: true });
                res.status(201).json({ message: 'Room added successfully.' });
            } catch (err) {
                console.error("Add Room Error:", err);
                if (err.errorNum === 1) {
                    res.status(409).json({ message: 'Room number already exists.' });
                } else {
                    res.status(500).json({ message: 'Failed to add room: ' + err.message });
                }
            } finally {
                if (connection) await connection.close();
            }
        });

        app.put('/api/rooms/:room_number', async (req, res) => {
            const { room_number } = req.params;
            const { type, costHour, costDay, discount, hotelName, photos } = req.body;
            
            // If photos is provided (even if null/empty string from JSON), update it. If undefined, ignore.
            let sql = `UPDATE hms_rooms SET room_type = :type, cost_per_hour = :costHour, cost_per_day = :costDay, discount_percent = :discount`;
            const binds = { type, costHour, costDay, discount, room_number, hotelName };
            
            if (photos !== undefined) {
                sql += `, photos = :photos`;
                binds.photos = photos;
            }
            
            sql += ` WHERE room_number = :room_number AND hotel_name = :hotelName`;

            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, binds, { autoCommit: true });
                if (result.rowsAffected === 0) {
                    res.status(404).json({ message: 'Room not found.' });
                } else {
                    res.json({ message: 'Room updated successfully.' });
                }
            } catch (err) {
                console.error("Update Room Error:", err);
                res.status(500).json({ message: 'Failed to update room.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.delete('/api/rooms/:room_number', async (req, res) => {
            const { room_number } = req.params;
            const { hotelName } = req.query;
            const sql = `DELETE FROM hms_rooms WHERE room_number = :room_number AND hotel_name = :hotelName`;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, { room_number, hotelName }, { autoCommit: true });
                if (result.rowsAffected === 0) {
                    res.status(404).json({ message: 'Room not found.' });
                } else {
                    res.json({ message: 'Room deleted successfully.' });
                }
            } catch (err) {
                console.error("Delete Room Error:", err);
                res.status(500).json({ message: 'Failed to delete room.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // --- Guest Routes ---
        app.get('/api/guests', async (req, res) => {
            const { hotelName } = req.query;
            if (!hotelName || hotelName === 'null' || hotelName === 'undefined') {
                return res.json([]);
            }
            const sql = `SELECT g.guest_id, g.guest_name, g.age, g.gender, g.country_code, g.mobile_number, g.email, g.room_number, g.check_in_time, g.address, g.verification_id_type, g.verification_id,
                                r.room_type, r.cost_per_day, r.discount_percent
                         FROM hms_guests g
                         LEFT JOIN hms_rooms r ON g.room_number = r.room_number AND g.hotel_name = r.hotel_name
                         WHERE g.hotel_name = :hotelName ORDER BY g.check_in_time DESC`;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, { hotelName }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
                res.json(result.rows);
            } catch (err) {
                console.error("Get Guests Error:", err);
                res.status(500).json({ message: 'Failed to fetch guests.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.post('/api/guests', async (req, res) => {
            const { name, age, gender, countryCode, mobile, email, room, checkIn, address, hotelName, verificationIdType, verificationId, otp } = req.body;
            
            // OTP Verification for new guests
            const storedOtpData = otpStore[email];
            const fiveMinutes = 5 * 60 * 1000;

            if (!storedOtpData || storedOtpData.otp !== otp || (Date.now() - storedOtpData.timestamp > fiveMinutes)) {
                return res.status(400).json({ message: 'Invalid or expired OTP.' });
            }
            delete otpStore[email]; // OTP is single-use

            const sql = `INSERT INTO hms_guests (guest_name, age, gender, country_code, mobile_number, email, room_number, check_in_time, address, hotel_name, verification_id_type, verification_id) 
                         VALUES (:name, :age, :gender, :countryCode, :mobile, :email, :room, TO_TIMESTAMP(:checkIn, 'YYYY-MM-DD"T"HH24:MI'), :address, :hotelName, :verificationIdType, :verificationId)`;
            let connection;

            try {
                connection = await pool.getConnection();
                await connection.execute(sql, {
                    name,
                    age,
                    gender,
                    countryCode,
                    mobile,
                    email: email || '',
                    room,
                    checkIn,
                    address,
                    hotelName,
                    verificationIdType,
                    verificationId
                }, { autoCommit: true });
                res.status(201).json({ message: 'Guest checked in successfully.' });

                // Send Welcome Email
                if (email) {
                    const html = createEmailTemplate('Check-in Successful', `<p>Dear ${name},</p><p>Welcome to <strong>${hotelName}</strong>!</p><p>You have successfully checked into <strong>Room ${room}</strong>.</p><p>We hope you have a pleasant stay.</p>`);
                    sendEmail(email, `Welcome to ${hotelName}`, `Welcome! You are in Room ${room}.`, html).catch(console.error);
                }

            } catch (err) {
                console.error("Add Guest Error:", err);
                if (err.errorNum === 2291) {
                    res.status(404).json({ message: `Room '${room}' does not exist.` });
                } else if (err.errorNum === 1) {
                    res.status(409).json({ message: `Room '${room}' is already occupied.` });
                } else {
                    res.status(500).json({ message: 'Failed to check in guest: ' + err.message });
                }
            } finally {
                if (connection) await connection.close();
            }
        });

        app.put('/api/guests/:guest_id', async (req, res) => {
            const { guest_id } = req.params;
            const { name, age, gender, countryCode, mobile, email, room, checkIn, address, hotelName, verificationIdType, verificationId } = req.body;
            const sql = `UPDATE hms_guests SET guest_name = :name, age = :age, gender = :gender, country_code = :countryCode, mobile_number = :mobile, email = :email,
                         room_number = :room, check_in_time = TO_TIMESTAMP(:checkIn, 'YYYY-MM-DD"T"HH24:MI'), address = :address,
                         verification_id_type = :verificationIdType, verification_id = :verificationId WHERE guest_id = :guest_id AND hotel_name = :hotelName`;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, {
                    name,
                    age,
                    gender,
                    countryCode,
                    mobile,
                    email: email || '',
                    room,
                    checkIn,
                    address,
                    guest_id,
                    hotelName,
                    verificationIdType,
                    verificationId
                }, { autoCommit: true });
                if (result.rowsAffected === 0) {
                    res.status(404).json({ message: 'Guest not found.' });
                } else {
                    res.json({ message: 'Guest updated successfully.' });
                }
            } catch (err) {
                console.error("Update Guest Error:", err);
                res.status(500).json({ message: 'Failed to update guest.' });
            } finally {
                if (connection) await connection.close();
            }
        });
        
        // --- Billing and History Routes ---
        app.post('/api/billing/checkout', async (req, res) => {
            const { guestId, hotelName, paymentMode } = req.body;
            let connection;
            try {
                connection = await pool.getConnection();

                const guestResult = await connection.execute(
                    `SELECT * FROM hms_guests WHERE guest_id = :guestId AND hotel_name = :hotelName`,
                    { guestId, hotelName },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                
                if (guestResult.rows.length === 0) {
                    return res.status(404).json({ message: 'Guest not found.' });
                }
                const guest = guestResult.rows[0];
                
                const roomResult = await connection.execute(
                    `SELECT * FROM hms_rooms WHERE room_number = :roomNum AND hotel_name = :hotelName`,
                    { roomNum: guest.ROOM_NUMBER, hotelName },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                
                if (roomResult.rows.length === 0) {
                    return res.status(404).json({ message: 'Room not found.' });
                }
                const room = roomResult.rows[0];

                const checkIn = new Date(guest.CHECK_IN_TIME);
                const checkOut = new Date();
                const hours = Math.ceil((checkOut - checkIn) / 3600000);
                const days = Math.floor(hours / 24);
                const remHours = hours % 24;
                const grossAmount = (days * room.COST_PER_DAY) + (remHours * room.COST_PER_HOUR);
                const discountAmount = (grossAmount * room.DISCOUNT_PERCENT) / 100;
                const finalAmount = grossAmount - discountAmount;

                const historySql = `INSERT INTO hms_bill_history (guest_name, room_number, check_in_time, check_out_time, total_hours, gross_amount, discount_amount, final_amount, hotel_name, payment_mode) 
                                    VALUES (:name, :room, :checkIn, :checkOut, :hours, :gross, :discount, :final, :hotel, :paymentMode)`;
                await connection.execute(historySql, {
                    name: guest.GUEST_NAME,
                    room: guest.ROOM_NUMBER,
                    checkIn: guest.CHECK_IN_TIME,
                    checkOut: checkOut,
                    hours: hours,
                    gross: grossAmount,
                    discount: discountAmount,
                    final: finalAmount,
                    hotel: hotelName,
                    paymentMode: paymentMode || 'Cash'
                });

                await connection.execute(
                    `DELETE FROM hms_guests WHERE guest_id = :guestId AND hotel_name = :hotelName`,
                    { guestId, hotelName }
                );
                
                await connection.commit();
                res.json({ message: 'Checkout successful!', finalAmount: finalAmount });
                
                // Send Thank You Email
                if (guest.EMAIL) {
                    const subject = `Thank you for staying at ${hotelName}`;
                    const html = createEmailTemplate('Thank You!', `<p>Dear ${guest.GUEST_NAME},</p><p>Thank you for staying at <strong>${hotelName}</strong>. We hope you enjoyed your stay!</p><p>We look forward to welcoming you back soon.</p><p><strong>Total Bill:</strong> ₹${finalAmount.toFixed(2)}</p>`);
                    sendEmail(guest.EMAIL, subject, `Thank you for staying at ${hotelName}. We hope to see you again!`, html).catch(console.error);
                }

            } catch (err) {
                console.error("Checkout Error:", err);
                if (connection) await connection.rollback();
                res.status(500).json({ message: 'Checkout failed: ' + err.message });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.get('/api/history', async (req, res) => {
            const { hotelName, startDate, endDate, limit, roomNumber } = req.query;
            if (!hotelName || hotelName === 'null' || hotelName === 'undefined') {
                return res.json([]);
            }
            let sql = `SELECT * FROM hms_bill_history WHERE hotel_name = :hotelName`;
            const binds = { hotelName };

            // Server-side filtering for reports
            if (startDate && endDate) {
                // Assuming dates are passed as YYYY-MM-DD
                sql += ` AND check_out_time >= TO_TIMESTAMP(:startDate, 'YYYY-MM-DD"T"HH24:MI:SS') 
                         AND check_out_time <= TO_TIMESTAMP(:endDate, 'YYYY-MM-DD"T"HH24:MI:SS')`;
                binds.startDate = startDate + 'T00:00:00';
                binds.endDate = endDate + 'T23:59:59';
            }

            if (roomNumber) {
                sql += ` AND room_number = :roomNumber`;
                binds.roomNumber = roomNumber;
            }

            sql += ` ORDER BY check_out_time DESC`;

            if (limit) {
                sql += ` FETCH FIRST :limit ROWS ONLY`;
                binds.limit = parseInt(limit);
            }

            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
                res.json(result.rows);
            } catch (err) {
                console.error("Get History Error:", err);
                res.status(500).json({ message: 'Failed to fetch history.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // --- Food & Dining Routes ---
        app.get('/api/food-orders', async (req, res) => {
            let connection;
            try {
                connection = await pool.getConnection();
                const { status, roomNumber, hotelName } = req.query;
                
                let query = 'SELECT id, room_number, items, total_cost, status, created_at FROM food_orders';
                const conditions = [];
                const binds = {};

                if (status) {
                    conditions.push("status = :status");
                    binds.status = status;
                }
                if (roomNumber) {
                    conditions.push("room_number = :roomNumber");
                    binds.roomNumber = roomNumber;
                }
                if (hotelName) {
                    conditions.push("hotel_name = :hotelName");
                    binds.hotelName = hotelName;
                }

                if (conditions.length > 0) {
                    query += ' WHERE ' + conditions.join(' AND ');
                }
                
                query += ' ORDER BY created_at DESC';

                const result = await connection.execute(query, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
                
                // Map database columns to frontend expected format
                const orders = result.rows.map(row => {
                    let parsedItems = [];
                    try {
                        parsedItems = JSON.parse(row.ITEMS);
                    } catch(e) { console.error("JSON Parse Error", e); }

                    return {
                        id: row.ID,
                        roomNumber: row.ROOM_NUMBER,
                        items: parsedItems,
                        totalCost: row.TOTAL_COST,
                        status: row.STATUS,
                        timestamp: row.CREATED_AT
                    };
                });
                
                res.json(orders);
            } catch (err) {
                console.error('Error fetching orders:', err);
                res.status(500).json({ message: 'Server error' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.post('/api/food-orders', async (req, res) => {
            let connection;
            try {
                connection = await pool.getConnection();
                const { roomNumber, items, totalCost, hotelName } = req.body;
                
                const sql = `
                    INSERT INTO food_orders (room_number, items, total_cost, status, hotel_name)
                    VALUES (:roomNumber, :items, :totalCost, 'Pending', :hotelName)
                    RETURNING id INTO :id
                `;
                
                const result = await connection.execute(sql, {
                    roomNumber,
                    items: JSON.stringify(items),
                    totalCost,
                    hotelName: hotelName || '',
                    id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
                }, { autoCommit: true });

                res.status(201).json({ message: 'Order placed successfully', orderId: result.outBinds.id[0] });
            } catch (err) {
                console.error('Error placing order:', err);
                res.status(500).json({ message: 'Failed to place order' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.put('/api/food-orders/:id', async (req, res) => {
            let connection;
            try {
                connection = await pool.getConnection();
                const { id } = req.params;
                const { status } = req.body;
                
                await connection.execute(
                    'UPDATE food_orders SET status = :status WHERE id = :id',
                    { status, id },
                    { autoCommit: true }
                );
                
                res.json({ message: 'Order status updated' });
            } catch (err) {
                console.error('Error updating order:', err);
                res.status(500).json({ message: 'Failed to update order' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // --- Service Requests Routes ---
        app.post('/api/service-requests', async (req, res) => {
            const { roomNumber, requestType, comments, hotelName } = req.body;
            let connection;
            try {
                connection = await pool.getConnection();
                const sql = `INSERT INTO service_requests (room_number, request_type, comments, status, hotel_name) 
                             VALUES (:roomNumber, :requestType, :comments, 'Pending', :hotelName)`;
                await connection.execute(sql, { roomNumber, requestType, comments: comments || '', hotelName: hotelName || '' }, { autoCommit: true });
                res.status(201).json({ message: 'Service request sent successfully.' });
            } catch (err) {
                console.error("Service Request Error:", err);
                res.status(500).json({ message: 'Failed to send request.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.get('/api/service-requests', async (req, res) => {
            const { status } = req.query;
            let sql = `SELECT * FROM service_requests`;
            const binds = {};
            if (status) {
                sql += ` WHERE status = :status`;
                binds.status = status;
            }
            sql += ` ORDER BY created_at ASC`;
            
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
                res.json(result.rows);
            } catch (err) {
                console.error("Get Service Requests Error:", err);
                res.status(500).json({ message: 'Failed to fetch requests.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.put('/api/service-requests/:id', async (req, res) => {
            const { id } = req.params;
            const { status } = req.body;
            let connection;
            try {
                connection = await pool.getConnection();
                await connection.execute(
                    `UPDATE service_requests SET status = :status WHERE id = :id`,
                    { status, id },
                    { autoCommit: true }
                );
                res.json({ message: 'Request updated.' });
            } catch (err) {
                console.error("Update Service Request Error:", err);
                res.status(500).json({ message: 'Failed to update request.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // --- Maintenance Logs Routes ---
        app.get('/api/maintenance', async (req, res) => {
            const { hotelName } = req.query;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(
                    `SELECT * FROM maintenance_logs WHERE hotel_name = :hotelName ORDER BY CASE status WHEN 'Reported' THEN 1 WHEN 'In Progress' THEN 2 ELSE 3 END, created_at DESC`,
                    { hotelName: hotelName || '' },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                res.json(result.rows);
            } catch (err) {
                console.error("Get Maintenance Error:", err);
                res.status(500).json({ message: 'Failed to fetch maintenance logs.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.post('/api/maintenance', async (req, res) => {
            const { roomNumber, itemName, description, priority, reportedBy, hotelName, photo } = req.body;
            let connection;
            try {
                connection = await pool.getConnection();
                await connection.execute(
                    `INSERT INTO maintenance_logs (room_number, item_name, description, priority, reported_by, hotel_name, photo) VALUES (:roomNumber, :itemName, :description, :priority, :reportedBy, :hotelName, :photo)`,
                    { roomNumber, itemName, description, priority, reportedBy, hotelName, photo: photo || null },
                    { autoCommit: true }
                );
                res.status(201).json({ message: 'Maintenance issue reported.' });
            } catch (err) {
                console.error("Add Maintenance Error:", err);
                res.status(500).json({ message: 'Failed to report issue.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.put('/api/maintenance/:id', async (req, res) => {
            const { id } = req.params;
            const { status } = req.body;
            let connection;
            try {
                connection = await pool.getConnection();
                await connection.execute(`UPDATE maintenance_logs SET status = :status WHERE id = :id`, { status, id }, { autoCommit: true });
                res.json({ message: 'Status updated.' });
            } catch (err) {
                console.error("Update Maintenance Error:", err);
                res.status(500).json({ message: 'Failed to update status.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // --- Lost & Found Routes ---
        app.get('/api/lost-found', async (req, res) => {
            const { hotelName } = req.query;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(
                    `SELECT * FROM hms_lost_found WHERE hotel_name = :hotelName ORDER BY date_found DESC`,
                    { hotelName: hotelName || '' },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                res.json(result.rows);
            } catch (err) {
                console.error("Get Lost & Found Error:", err);
                res.status(500).json({ message: 'Failed to fetch items.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.post('/api/lost-found', async (req, res) => {
            const { itemName, description, location, foundBy, hotelName } = req.body;
            let connection;
            try {
                connection = await pool.getConnection();
                await connection.execute(
                    `INSERT INTO hms_lost_found (item_name, description, found_location, found_by, hotel_name) VALUES (:itemName, :description, :location, :foundBy, :hotelName)`,
                    { itemName, description, location, foundBy, hotelName },
                    { autoCommit: true }
                );
                res.status(201).json({ message: 'Item recorded.' });
            } catch (err) {
                console.error("Add Lost & Found Error:", err);
                res.status(500).json({ message: 'Failed to record item.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.put('/api/lost-found/:id', async (req, res) => {
            const { id } = req.params;
            const { status, claimedBy } = req.body;
            let connection;
            try {
                connection = await pool.getConnection();
                await connection.execute(
                    `UPDATE hms_lost_found SET status = :status, claimed_by = :claimedBy, date_claimed = CURRENT_TIMESTAMP WHERE id = :id`,
                    { status, claimedBy, id },
                    { autoCommit: true }
                );
                res.json({ message: 'Item status updated.' });
            } catch (err) {
                console.error("Update Lost & Found Error:", err);
                res.status(500).json({ message: 'Failed to update item.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // --- Menu Management Routes ---
        app.get('/api/menu', async (req, res) => {
            const { hotelName } = req.query;
            let connection;
            try {
                connection = await pool.getConnection();
                // Filter by hotelName if provided, otherwise show all (or handle global items)
                const result = await connection.execute(
                    `SELECT id, name, price, image_url, NVL(is_available, 1) as is_available, category FROM food_menu WHERE hotel_name = :hotelName OR hotel_name IS NULL ORDER BY category, name`,
                    { hotelName: hotelName || '' },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                res.json(result.rows);
            } catch (err) {
                console.error('Error fetching menu:', err);
                res.status(500).json({ message: 'Failed to fetch menu.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.post('/api/menu', async (req, res) => {
            const { name, price, imageUrl, category, hotelName } = req.body;
            let connection;
            try {
                connection = await pool.getConnection();
                await connection.execute(
                    `INSERT INTO food_menu (name, price, image_url, category, hotel_name) VALUES (:name, :price, :imageUrl, :category, :hotelName)`,
                    { name, price, imageUrl: imageUrl || '', category: category || 'Main Course', hotelName: hotelName || '' },
                    { autoCommit: true }
                );
                res.status(201).json({ message: 'Menu item added.' });
            } catch (err) {
                console.error('Error adding menu item:', err);
                res.status(500).json({ message: 'Failed to add item.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.put('/api/menu/:id', async (req, res) => {
            const { id } = req.params;
            const { name, price, imageUrl, category, isAvailable } = req.body;
            
            let updates = [];
            const binds = { id };

            if (name) { updates.push("name = :name"); binds.name = name; }
            if (price) { updates.push("price = :price"); binds.price = price; }
            if (imageUrl !== undefined) { updates.push("image_url = :imageUrl"); binds.imageUrl = imageUrl; }
            if (category) { updates.push("category = :category"); binds.category = category; }
            if (isAvailable !== undefined) { updates.push("is_available = :isAvailable"); binds.isAvailable = isAvailable ? 1 : 0; }
            
            if (updates.length === 0) return res.status(400).json({ message: "No fields to update." });

            const sql = `UPDATE food_menu SET ${updates.join(', ')} WHERE id = :id`;

            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, binds, { autoCommit: true });
                if (result.rowsAffected === 0) {
                    res.status(404).json({ message: 'Menu item not found.' });
                } else {
                    res.json({ message: 'Menu item updated successfully.' });
                }
            } catch (err) {
                console.error('Error updating menu item:', err);
                res.status(500).json({ message: 'Failed to update item.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // Bulk Add Menu Items
        app.post('/api/menu/bulk', async (req, res) => {
            const { items, hotelName } = req.body; // Array of { name, price, category, imageUrl }
            if (!items || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ message: 'No items provided.' });
            }

            let connection;
            try {
                connection = await pool.getConnection();
                const sql = `INSERT INTO food_menu (name, price, image_url, category, hotel_name) VALUES (:name, :price, :imageUrl, :category, :hotelName)`;
                const binds = items.map(i => ({
                    name: i.name,
                    price: i.price,
                    imageUrl: i.imageUrl || '',
                    category: i.category || 'Main Course',
                    hotelName: hotelName || ''
                }));

                const result = await connection.executeMany(sql, binds, { autoCommit: true });
                res.status(201).json({ message: `${result.rowsAffected} items added successfully.` });
            } catch (err) {
                console.error('Error bulk adding menu items:', err);
                res.status(500).json({ message: 'Failed to add items.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // Bulk Delete Menu Items
        app.post('/api/menu/bulk-delete', async (req, res) => {
            const { ids } = req.body; // Array of IDs
            if (!ids || !Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ message: 'No IDs provided.' });
            }

            let connection;
            try {
                connection = await pool.getConnection();
                const sql = `DELETE FROM food_menu WHERE id = :id`;
                const binds = ids.map(id => ({ id }));

                const result = await connection.executeMany(sql, binds, { autoCommit: true });
                res.json({ message: `${result.rowsAffected} items deleted.` });
            } catch (err) {
                console.error('Error bulk deleting menu items:', err);
                res.status(500).json({ message: 'Failed to delete items.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // --- Hotel Features Routes ---
        app.get('/api/hotel-features', async (req, res) => {
            const { hotelName } = req.query;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(
                    `SELECT * FROM hotel_features WHERE hotel_name = :hotelName ORDER BY id DESC`,
                    { hotelName: hotelName || '' },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                res.json(result.rows);
            } catch (err) {
                console.error("Get Features Error:", err);
                res.status(500).json({ message: 'Failed to fetch features.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.post('/api/hotel-features', async (req, res) => {
            const { featureText, icon, hotelName } = req.body;
            let connection;
            try {
                connection = await pool.getConnection();
                await connection.execute(
                    `INSERT INTO hotel_features (feature_text, icon, hotel_name) VALUES (:featureText, :icon, :hotelName)`,
                    { featureText, icon: icon || 'fa-star', hotelName },
                    { autoCommit: true }
                );
                res.status(201).json({ message: 'Feature added.' });
            } catch (err) {
                console.error("Add Feature Error:", err);
                res.status(500).json({ message: 'Failed to add feature.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.delete('/api/hotel-features/:id', async (req, res) => {
            const { id } = req.params;
            let connection;
            try {
                connection = await pool.getConnection();
                await connection.execute(`DELETE FROM hotel_features WHERE id = :id`, { id }, { autoCommit: true });
                res.json({ message: 'Feature deleted.' });
            } catch (err) {
                console.error("Delete Feature Error:", err);
                res.status(500).json({ message: 'Failed to delete feature.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // Get Hotel Public Settings (Scroll Speed)
        app.get('/api/hotel/settings', async (req, res) => {
            const { hotelName } = req.query;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(
                    `SELECT feature_scroll_speed, upi_id, theme_color FROM hms_users WHERE hotel_name = :hotelName AND role = 'Owner' FETCH FIRST 1 ROWS ONLY`,
                    { hotelName },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                res.json(result.rows.length > 0 ? result.rows[0] : { FEATURE_SCROLL_SPEED: 20 });
            } catch (err) {
                res.status(500).json({ message: 'Error fetching settings' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // Get Hotel Contact Details (Public)
        app.get('/api/hotel/contact', async (req, res) => {
            const { hotelName } = req.query;
            const sql = `SELECT full_name, email, mobile_number, address FROM hms_users WHERE hotel_name = :hotelName AND role = 'Owner' FETCH FIRST 1 ROWS ONLY`;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, { hotelName }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
                if (result.rows.length > 0) {
                    res.json(result.rows[0]);
                } else {
                    res.status(404).json({ message: 'Contact details not found.' });
                }
            } catch (err) {
                res.status(500).json({ message: 'Error fetching contact details.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // --- UI Settings Routes ---
        app.get('/api/ui-settings', async (req, res) => {
            const { hotelName } = req.query;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(
                    `SELECT * FROM hms_ui_settings WHERE hotel_name = :hotelName`,
                    { hotelName: hotelName || 'HMS_GLOBAL' },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                if (result.rows.length > 0) {
                    res.json(result.rows[0]);
                } else {
                    res.json({}); // Return empty object if no settings found
                }
            } catch (err) {
                console.error("Get UI Settings Error:", err);
                res.status(500).json({ message: 'Failed to fetch UI settings.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.post('/api/ui-settings', async (req, res) => {
            const { hotelName, primaryColor, secondaryColor, sidebarBg, sidebarText, bgColor, surfaceColor, textColor, guestLoginBg } = req.body;
            const targetHotel = hotelName || 'HMS_GLOBAL';
            
            const sql = `MERGE INTO hms_ui_settings d
                         USING (SELECT :hotelName as hotel_name FROM dual) s
                         ON (d.hotel_name = s.hotel_name)
                         WHEN MATCHED THEN UPDATE SET 
                             primary_color = :primaryColor, secondary_color = :secondaryColor,
                             sidebar_bg = :sidebarBg, sidebar_text = :sidebarText,
                             bg_color = :bgColor, surface_color = :surfaceColor,
                             text_color = :textColor, guest_login_bg = :guestLoginBg
                         WHEN NOT MATCHED THEN INSERT (hotel_name, primary_color, secondary_color, sidebar_bg, sidebar_text, bg_color, surface_color, text_color, guest_login_bg)
                         VALUES (:hotelName, :primaryColor, :secondaryColor, :sidebarBg, :sidebarText, :bgColor, :surfaceColor, :textColor, :guestLoginBg)`;
            
            let connection;
            try {
                connection = await pool.getConnection();
                await connection.execute(sql, {
                    hotelName: targetHotel,
                    primaryColor: primaryColor || null,
                    secondaryColor: secondaryColor || null,
                    sidebarBg: sidebarBg || null,
                    sidebarText: sidebarText || null,
                    bgColor: bgColor || null,
                    surfaceColor: surfaceColor || null,
                    textColor: textColor || null,
                    guestLoginBg: guestLoginBg || null
                }, { autoCommit: true });
                res.json({ message: 'UI settings saved successfully.' });
            } catch (err) {
                console.error("Save UI Settings Error:", err);
                res.status(500).json({ message: 'Failed to save UI settings.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // --- Employee Payroll Routes ---
        app.get('/api/admin/employees-payroll', async (req, res) => {
            const { hotelName } = req.query;
            const sql = `
                SELECT u.user_id, u.full_name, u.role, u.email,
                       d.salary, d.bank_account, d.ifsc, d.reports_to,
                       m.full_name as reports_to_name
                FROM hms_users u
                LEFT JOIN hms_employee_details d ON u.user_id = d.user_id
                LEFT JOIN hms_users m ON d.reports_to = m.user_id
                WHERE u.hotel_name = :hotelName AND u.role != 'Owner'
                ORDER BY u.full_name
            `;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, { hotelName }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
                res.json(result.rows);
            } catch (err) {
                console.error("Get Payroll Error:", err);
                res.status(500).json({ message: 'Failed to fetch payroll data.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.put('/api/admin/employees-payroll', async (req, res) => {
            const { userId, salary, bankAccount, ifsc, reportsTo } = req.body;
            // Oracle MERGE to upsert
            const sql = `
                MERGE INTO hms_employee_details d
                USING (SELECT :userId as user_id, :salary as salary, :bank as bank_account, :ifsc as ifsc, :reportsTo as reports_to FROM dual) s
                ON (d.user_id = s.user_id)
                WHEN MATCHED THEN UPDATE SET salary = s.salary, bank_account = s.bank_account, ifsc = s.ifsc, reports_to = s.reports_to
                WHEN NOT MATCHED THEN INSERT (user_id, salary, bank_account, ifsc, reports_to) VALUES (s.user_id, s.salary, s.bank_account, s.ifsc, s.reports_to)
            `;
            let connection;
            try {
                connection = await pool.getConnection();
                await connection.execute(sql, {
                    userId, 
                    salary: salary || 0, 
                    bank: bankAccount || '', 
                    ifsc: ifsc || '', 
                    reportsTo: reportsTo || null
                }, { autoCommit: true });
                res.json({ message: 'Employee details updated successfully.' });
            } catch (err) {
                console.error("Update Payroll Error:", err);
                res.status(500).json({ message: 'Failed to update details.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.post('/api/admin/pay-salary', async (req, res) => {
            const { userIds, hotelName } = req.body; // Array of user IDs
            if (!userIds || userIds.length === 0) return res.status(400).json({ message: "No employees selected." });

            let connection;
            try {
                connection = await pool.getConnection();
                // Verify users exist and belong to hotel
                // For simulation, we assume success if they exist.
                // In a real app, we would integrate with a Payment Gateway here.
                
                // Log the payment (Simulated)
                console.log(`[Payroll] Processing salary for ${userIds.length} employees in ${hotelName}`);
                
                // Send notification emails (Simulated loop)
                // const users = await connection.execute(`SELECT email, full_name FROM hms_users WHERE user_id IN (${userIds.join(',')})`);
                // users.rows.forEach(u => sendEmail(u.EMAIL, 'Salary Credited', ...));

                res.json({ message: `Salary payment initiated for ${userIds.length} employee(s).` });
            } catch (err) {
                console.error("Pay Salary Error:", err);
                res.status(500).json({ message: 'Payment processing failed.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // --- System Control Routes ---
        app.get('/api/admin/control/status', (req, res) => {
            res.json({ api: apiEnabled, db: !!pool });
        });

        app.post('/api/admin/control/api', (req, res) => {
            const { action, subsystem } = req.body;
            
            if (subsystem) {
                // Granular control
                if (apiGroups[subsystem]) {
                    if (action === 'restart') {
                        apiGroups[subsystem].enabled = false;
                        setTimeout(() => { apiGroups[subsystem].enabled = true; }, 1500);
                        res.json({ message: `${subsystem} restarting...` });
                    } else {
                        apiGroups[subsystem].enabled = (action === 'start');
                        res.json({ message: `${subsystem} ${action === 'start' ? 'started' : 'stopped'}.` });
                    }
                } else {
                    res.status(404).json({ message: 'Subsystem not found.' });
                }
            } else if (!subsystem) {
                // Global control
                if (action === 'restart') {
                    apiEnabled = false;
                    setTimeout(() => { apiEnabled = true; }, 1500);
                    res.json({ message: 'All APIs restarting...' });
                } else if (action === 'start') {
                    apiEnabled = true;
                    res.json({ message: 'APIs started successfully.' });
                } else if (action === 'stop') {
                    apiEnabled = false;
                    res.json({ message: 'APIs stopped. Maintenance mode active.' });
                } else {
                    res.status(400).json({ message: 'Invalid action.' });
                }
            } else {
                res.status(400).json({ message: 'Invalid action.' });
            }
        });

        app.post('/api/admin/control/db', async (req, res) => {
            const { action } = req.body;
            if (action === 'restart') {
                if (pool) {
                    try { await pool.close(); } catch (e) { console.error("Error closing DB for restart:", e.message); }
                    pool = null;
                }
                const success = await initDb();
                if (success) res.json({ message: 'Database connection restarted.' });
                else res.status(500).json({ message: 'Failed to restart database connection.' });
            } else if (action === 'start') {
                if (pool) return res.json({ message: 'Database is already connected.' });
                const success = await initDb();
                if (success) res.json({ message: 'Database connected successfully.' });
                else res.status(500).json({ message: 'Failed to connect to database.' });
            } else if (action === 'stop') {
                if (pool) {
                    try {
                        await pool.close();
                        pool = null;
                        res.json({ message: 'Database connection closed.' });
                    } catch (err) {
                        res.status(500).json({ message: 'Error closing database: ' + err.message });
                    }
                } else {
                    res.json({ message: 'Database is already disconnected.' });
                }
            } else {
                res.status(400).json({ message: 'Invalid action.' });
            }
        });

        app.post('/api/admin/control/server', (req, res) => {
            const { action } = req.body;
            if (action === 'stop') {
                res.json({ message: 'Server shutting down...' });
                setTimeout(() => closePoolAndExit(), 100);
            } else {
                res.status(400).json({ message: 'Only stop action is supported for server.' });
            }
        });

        app.post('/api/admin/control/restart', (req, res) => {
            res.json({ message: 'Server restarting...' });
            
            // Attempt to spawn a new process and exit the current one
            setTimeout(() => {
                const { spawn } = require('child_process');
                if (process.argv[1]) {
                    spawn(process.argv[0], process.argv.slice(1), {
                        cwd: process.cwd(),
                        detached: true,
                        stdio: 'inherit'
                    }).unref();
                }
                closePoolAndExit();
            }, 1000);
        });

        // --- Setup Route (Dev only) ---
        app.get('/api/setup-admin', async (req, res) => {
            const adminData = {
                fullName: 'System Admin',
                username: 'admin',
                password: 'admin123', // In production, hash this!
                email: 'admin@hms.com',
                mobile: '0000000000',
                role: 'Admin',
                hotelName: 'HMS_GLOBAL',
                address: 'Global Admin Office'
            };
            
            let connection;
            try {
                connection = await pool.getConnection();
                // Check if exists
                const check = await connection.execute(`SELECT user_id FROM hms_users WHERE username = :username`, { username: adminData.username });
                if (check.rows.length > 0) {
                    return res.json({ message: 'Admin account already exists.' });
                }

                const sql = `INSERT INTO hms_users (full_name, username, password, email, mobile_number, role, hotel_name, address, perm_manage_rooms, perm_add_guests, perm_edit_guests) 
                             VALUES (:fullName, :username, :password, :email, :mobile, :role, :hotelName, :address, 1, 1, 1)`;
                
                try {
                    await connection.execute(sql, adminData, { autoCommit: true });
                } catch (insertErr) {
                    // Handle ORA-02290: check constraint violated (CHK_USER_ROLE)
                    if (insertErr.errorNum === 2290 && (insertErr.message.includes('CHK_USER_ROLE') || insertErr.message.includes('check constraint'))) {
                        console.log("⚠️ Constraint violation detected. Attempting to update CHK_USER_ROLE to include 'Admin'...");
                        // Drop and recreate constraint to include 'Admin'
                        await connection.execute(`ALTER TABLE hms_users DROP CONSTRAINT CHK_USER_ROLE`);
                        await connection.execute(`ALTER TABLE hms_users ADD CONSTRAINT CHK_USER_ROLE CHECK (role IN ('Owner', 'Manager', 'Employee', 'Chef', 'Waiter', 'Housekeeping', 'Room', 'Admin'))`);
                        console.log("✅ Constraint updated. Retrying admin creation...");
                        await connection.execute(sql, adminData, { autoCommit: true });
                    } else {
                        throw insertErr;
                    }
                }
                
                res.json({ message: 'Default Admin account created. Username: admin, Password: admin123' });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: 'Error creating admin.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // --- Force Delete User (Dev only) ---
        app.get('/api/force-delete-user/:username', async (req, res) => {
            const { username } = req.params;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(
                    `DELETE FROM hms_users WHERE username = :username`,
                    { username },
                    { autoCommit: true }
                );
                res.json({ message: `User '${username}' deleted. Rows affected: ${result.rowsAffected}` });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: 'Error deleting user.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.delete('/api/menu/:id', async (req, res) => {
            const { id } = req.params;
            let connection;
            try {
                connection = await pool.getConnection();
                await connection.execute(
                    `DELETE FROM food_menu WHERE id = :id`,
                    { id },
                    { autoCommit: true }
                );
                res.json({ message: 'Menu item deleted.' });
            } catch (err) {
                console.error('Error deleting menu item:', err);
                res.status(500).json({ message: 'Failed to delete item.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        // --- Catch-all for Hotel Slugs ---
        // This must be after all API routes but before the server listen
        app.get('/:slug', (req, res, next) => {
            // If it looks like a file extension (e.g. .js, .css) and isn't our custom .com slug, skip
            if (req.params.slug.includes('.') && !req.params.slug.endsWith('.com')) return next();
            
            // Serve the main index.html for the frontend to handle the routing
            res.sendFile(path.join(__dirname, '../index.html'));
        });

        // --- Start the Express Server ---
        server = app.listen(port, () => {
            console.log(`🚀 Server running on http://localhost:${port}`);
            console.log(`📂 Serving frontend from: ${path.join(__dirname, '../')}`);
            console.log(`✅ Health check available at http://localhost:${port}/api/health`);
        });

    } catch (err) {
        console.error("❌ Error starting server or creating connection pool:", err);
        console.error("Full error details:", err.message);
        console.log("\n⚠️  Troubleshooting steps:");
        console.log("1. Check if Oracle Database is running");
        console.log("2. Verify database credentials in dbConfig");
        console.log("3. Ensure Oracle Instant Client is installed");
        console.log("4. Check if the database service is accessible at localhost:1521/XEPDB1");
        process.exit(1);
    }

    // --- Graceful Shutdown Logic inside startServer scope to access 'server' ---
    async function closePoolAndExit() {
        console.log('\nReceived kill signal, shutting down gracefully...');
        
        // 1. Stop accepting new HTTP requests
        if (typeof server !== 'undefined') {
            server.close(() => {
                console.log('Closed out remaining connections');
            });
        }

        // 2. Close DB Pool
        try {
            await oracledb.getPool().close(10);
            console.log('Oracle Database pool closed');
            process.exit(0);
        } catch (err) {
            console.error('Error closing pool', err);
            process.exit(1);
        }
    }

    process.once('SIGTERM', closePoolAndExit).once('SIGINT', closePoolAndExit);
}

// --- Auto-Cancel Pending Payments (Cron Job) ---
setInterval(async () => {
    let connection;
    try {
        // Connect to DB
        const pool = oracledb.getPool();
        if (!pool) return;
        
        connection = await pool.getConnection();
        
        // Cancel bookings pending for more than 30 minutes
        const timeLimit = new Date(Date.now() - 30 * 60 * 1000);
        
        const result = await connection.execute(
            `SELECT booking_id, email, hotel_name FROM hms_online_bookings 
             WHERE booking_status = 'Pending Payment' AND updated_at < :timeLimit`,
            { timeLimit },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        
        if (result.rows.length > 0) {
            console.log(`[Auto-Cancel] Found ${result.rows.length} expired pending bookings.`);
            for (const b of result.rows) {
                await connection.execute(
                    `UPDATE hms_online_bookings SET booking_status = 'Declined' WHERE booking_id = :id`,
                    { id: b.BOOKING_ID }, { autoCommit: true }
                );
                if (b.EMAIL) {
                    const msg = `Your booking #${b.BOOKING_ID} at ${b.HOTEL_NAME} has been cancelled due to payment timeout.`;
                    const html = createEmailTemplate('Booking Cancelled', `<p>${msg}</p>`);
                    sendEmail(b.EMAIL, 'Booking Cancelled - Payment Timeout', msg, html).catch(console.error);
                }
            }
        }
    } catch (e) {
        console.error("Auto-cancel error:", e.message);
    } finally {
        if (connection) { try { await connection.close(); } catch(e) {} }
    }
}, 60 * 1000); // Run every minute


// Run the server
startServer();