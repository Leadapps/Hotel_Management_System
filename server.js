// server.js

// Import required packages
const express = require('express');
require('dotenv').config();
const { Pool } = require('pg'); // Use the PostgreSQL driver
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// --- PostgreSQL Connection Configuration ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Render to connect to Supabase
  }
});

// --- Server Configuration ---
const app = express();
const port = process.env.PORT || 3000;
const MAIN_APP_DOMAIN = process.env.MAIN_APP_DOMAIN || 'myhmsapp.com';

// --- Twilio Configuration ---
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const twilioClient = require('twilio')(twilioAccountSid, twilioAuthToken);

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/dashboard.html', express.static(path.join(__dirname, 'dashboard.html')));

const otpStore = {};

// --- Domain-Based Routing ---
app.get('/', async (req, res) => {
    const host = req.hostname;
    let hotelName = null;
    
    try {
        let result;
        if (host.endsWith(`.${MAIN_APP_DOMAIN}`) && host !== `www.${MAIN_APP_DOMAIN}` && host !== MAIN_APP_DOMAIN) {
            const subdomain = host.split('.')[0];
            const sql = `SELECT hotel_name FROM hms_users WHERE staff_subdomain = $1 AND role = 'Owner'`;
            result = await pool.query(sql, [subdomain]);
        } else if (host !== MAIN_APP_DOMAIN && host !== `www.${MAIN_APP_DOMAIN}`) {
            const domain = host.startsWith('www.') ? host.substring(4) : host;
            const sql = `SELECT hotel_name FROM hms_users WHERE guest_domain = $1 AND role = 'Owner'`;
            result = await pool.query(sql, [domain]);
        }

        if (result && result.rows.length > 0) {
            hotelName = result.rows[0].hotel_name;
        }
    } catch (err) {
        console.error("Domain lookup database error:", err);
        return res.status(500).send("Error identifying hotel information.");
    }

    const indexPath = path.join(__dirname, 'views', 'index.html');
    fs.readFile(indexPath, 'utf8', (err, htmlData) => {
        if (err) {
            console.error("Could not read index.html:", err);
            return res.status(500).send("Could not load the application page.");
        }
        const modifiedHtml = htmlData.replace(
            '</head>',
            `<script>window.HOTEL_CONFIG = { name: ${hotelName ? `'${hotelName}'` : 'null'} };</script></head>`
        );
        res.send(modifiedHtml);
    });
});

// ====================================================================
// API Routes (All routes converted to PostgreSQL)
// ====================================================================

// --- User & Auth Routes ---
app.post('/api/register', async (req, res) => {
    const { fullName, username, password, role, address, hotelName } = req.body;
    const sql = `INSERT INTO hms_users (full_name, username, password, role, address, hotel_name) VALUES ($1, $2, $3, $4, $5, $6)`;
    try {
        await pool.query(sql, [fullName, username, password, role, address || '', hotelName]);
        res.status(201).json({ message: 'User registered successfully!' });
    } catch (err) {
        if (err.code === '23505') res.status(409).json({ message: 'Username already exists.' });
        else { console.error(err); res.status(500).json({ message: 'Registration failed.' }); }
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const sql = `SELECT * FROM hms_users WHERE username = $1 AND password = $2`;
    try {
        const result = await pool.query(sql, [username, password]);
        if (result.rows.length > 0) {
            const dbUser = result.rows[0];
            const user = {
                userId: dbUser.user_id, fullName: dbUser.full_name, username: dbUser.username,
                role: dbUser.role, address: dbUser.address, hotelName: dbUser.hotel_name,
                permissions: {
                    manageRooms: dbUser.perm_manage_rooms,
                    addGuests: dbUser.perm_add_guests,
                    editGuests: dbUser.perm_edit_guests
                }
            };
            res.json(user);
        } else {
            res.status(401).json({ message: 'Invalid username or password.' });
        }
    } catch (err) { console.error(err); res.status(500).json({ message: 'Server error during login.' }); }
});

app.get('/api/users', async (req, res) => {
    const { hotelName } = req.query;
    const sql = `SELECT user_id, full_name, role, address, perm_manage_rooms, perm_add_guests, perm_edit_guests 
                 FROM hms_users WHERE role != 'Owner' AND hotel_name = $1 ORDER BY full_name`;
    try {
        const result = await pool.query(sql, [hotelName]);
        res.json(result.rows);
    } catch (err) { console.error(err); res.status(500).json({ message: 'Failed to fetch users.' }); }
});

app.put('/api/users/:user_id/permissions', async (req, res) => {
    const { user_id } = req.params;
    const permissionMap = { manageRooms: 'perm_manage_rooms', addGuests: 'perm_add_guests', editGuests: 'perm_edit_guests' };
    const permissionKey = Object.keys(req.body)[0];
    const column = permissionMap[permissionKey];
    if (!column) return res.status(400).json({ message: 'Invalid permission key.' });

    const value = req.body[permissionKey];
    const sql = `UPDATE hms_users SET ${column} = $1 WHERE user_id = $2`;
    try {
        await pool.query(sql, [value, user_id]);
        res.json({ message: 'Permission updated successfully.' });
    } catch (err) { console.error(err); res.status(500).json({ message: 'Failed to update permissions.' }); }
});

// --- Room Routes ---
app.get('/api/rooms', async (req, res) => {
    const { hotelName } = req.query;
    const sql = `SELECT * FROM hms_rooms WHERE hotel_name = $1 ORDER BY room_number`;
    try { const result = await pool.query(sql, [hotelName]); res.json(result.rows); }
    catch (err) { console.error(err); res.status(500).json({ message: 'Failed to fetch rooms.' }); }
});

app.post('/api/rooms', async (req, res) => {
    const { type, number, costHour, costDay, discount, hotelName } = req.body;
    const sql = `INSERT INTO hms_rooms (room_type, room_number, cost_per_hour, cost_per_day, discount_percent, hotel_name) 
                 VALUES ($1, $2, $3, $4, $5, $6)`;
    try {
        await pool.query(sql, [type, number, costHour, costDay, discount || 0, hotelName]);
        res.status(201).json({ message: 'Room added successfully.' });
    } catch (err) {
        if (err.code === '23505') res.status(409).json({ message: 'Room number already exists.' });
        else { console.error(err); res.status(500).json({ message: 'Failed to add room.' }); }
    }
});

app.put('/api/rooms/:room_number', async (req, res) => {
    const { room_number } = req.params;
    const { type, costHour, costDay, discount, hotelName } = req.body;
    const sql = `UPDATE hms_rooms SET room_type = $1, cost_per_hour = $2, cost_per_day = $3, discount_percent = $4 
                 WHERE room_number = $5 AND hotel_name = $6`;
    try {
        const result = await pool.query(sql, [type, costHour, costDay, discount, room_number, hotelName]);
        if (result.rowCount === 0) res.status(404).json({ message: 'Room not found.' });
        else res.json({ message: 'Room updated successfully.' });
    } catch (err) { console.error(err); res.status(500).json({ message: 'Failed to update room.' }); }
});

app.delete('/api/rooms/:room_number', async (req, res) => {
    const { room_number } = req.params;
    const { hotelName } = req.query;
    const sql = `DELETE FROM hms_rooms WHERE room_number = $1 AND hotel_name = $2`;
    try {
        const result = await pool.query(sql, [room_number, hotelName]);
        if (result.rowCount === 0) res.status(404).json({ message: 'Room not found.' });
        else res.json({ message: 'Room deleted successfully.' });
    } catch (err) { console.error(err); res.status(500).json({ message: 'Failed to delete room.' }); }
});

// --- Guest & Check-in Routes ---
app.get('/api/guests', async (req, res) => {
    const { hotelName } = req.query;
    const sql = `SELECT g.*, r.room_type, r.cost_per_day, r.discount_percent FROM hms_guests g
                 LEFT JOIN hms_rooms r ON g.room_number = r.room_number AND g.hotel_name = r.hotel_name
                 WHERE g.hotel_name = $1 ORDER BY g.check_in_time DESC`;
    try { const result = await pool.query(sql, [hotelName]); res.json(result.rows); }
    catch (err) { console.error(err); res.status(500).json({ message: 'Failed to fetch guests.' }); }
});

app.post('/api/guests', async (req, res) => {
    const { name, age, gender, countryCode, mobile, room, checkIn, address, hotelName, verificationIdType, verificationId, otp } = req.body;
    const fullMobile = `${countryCode}${mobile}`;
    const storedOtp = otpStore[fullMobile];
    if (!storedOtp || storedOtp.otp !== otp || (Date.now() - storedOtp.timestamp > 300000)) {
        return res.status(400).json({ message: 'Invalid or expired OTP.' });
    }
    delete otpStore[fullMobile];

    const sql = `INSERT INTO hms_guests (guest_name, age, gender, country_code, mobile_number, room_number, check_in_time, address, hotel_name, verification_id_type, verification_id) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`;
    try {
        await pool.query(sql, [name, age, gender, countryCode, mobile, room, checkIn, address, hotelName, verificationIdType, verificationId]);
        res.status(201).json({ message: 'Guest checked in successfully.' });
    } catch (err) {
        if (err.code === '23505') res.status(409).json({ message: `Room '${room}' is already occupied.` });
        else { console.error(err); res.status(500).json({ message: 'Failed to check in guest.' }); }
    }
});

app.put('/api/guests/:guest_id', async (req, res) => {
    const { guest_id } = req.params;
    const { name, age, gender, countryCode, mobile, room, checkIn, verificationIdType, verificationId } = req.body;
    const sql = `UPDATE hms_guests SET guest_name = $1, age = $2, gender = $3, country_code = $4, mobile_number = $5, room_number = $6, check_in_time = $7, verification_id_type = $8, verification_id = $9
                 WHERE guest_id = $10`;
    try {
        const result = await pool.query(sql, [name, age, gender, countryCode, mobile, room, checkIn, verificationIdType, verificationId, guest_id]);
        if (result.rowCount === 0) res.status(404).json({ message: 'Guest not found.' });
        else res.json({ message: 'Guest updated successfully.' });
    } catch (err) { console.error(err); res.status(500).json({ message: 'Failed to update guest.' }); }
});

// --- Billing & History ---
app.post('/api/billing/checkout', async (req, res) => {
    const { guestId, hotelName } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const guestRes = await client.query('SELECT * FROM hms_guests WHERE guest_id = $1 AND hotel_name = $2', [guestId, hotelName]);
        if (guestRes.rows.length === 0) throw new Error('Guest not found.');
        const guest = guestRes.rows[0];

        const roomRes = await client.query('SELECT * FROM hms_rooms WHERE room_number = $1 AND hotel_name = $2', [guest.room_number, hotelName]);
        if (roomRes.rows.length === 0) throw new Error('Room details not found.');
        const room = roomRes.rows[0];

        const checkIn = new Date(guest.check_in_time);
        const checkOut = new Date();
        const hours = Math.ceil((checkOut - checkIn) / 3600000);
        const days = Math.floor(hours / 24);
        const remHours = hours % 24;
        const gross = (days * room.cost_per_day) + (remHours * room.cost_per_hour);
        const discount = (gross * room.discount_percent) / 100;
        const final = gross - discount;

        const historySql = `INSERT INTO hms_bill_history (guest_name, room_number, check_in_time, check_out_time, total_hours, gross_amount, discount_amount, final_amount, hotel_name)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
        await client.query(historySql, [guest.guest_name, guest.room_number, guest.check_in_time, checkOut, hours, gross, discount, final, hotelName]);

        await client.query('DELETE FROM hms_guests WHERE guest_id = $1', [guestId]);
        await client.query('COMMIT');
        res.json({ message: 'Checkout successful!', finalAmount: final });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Checkout Error:", err);
        res.status(500).json({ message: err.message || 'Checkout failed.' });
    } finally {
        client.release();
    }
});

app.get('/api/history', async (req, res) => {
    const { hotelName } = req.query;
    const sql = `SELECT * FROM hms_bill_history WHERE hotel_name = $1 ORDER BY check_out_time DESC`;
    try { const result = await pool.query(sql, [hotelName]); res.json(result.rows); }
    catch (err) { console.error(err); res.status(500).json({ message: 'Failed to fetch history.' }); }
});

// --- Guest Booking & OTP Routes ---
app.post('/api/guest/send-otp', async (req, res) => {
    const { countryCode, mobileNumber } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const fullMobile = `${countryCode}${mobileNumber}`;
    otpStore[fullMobile] = { otp, timestamp: Date.now() };

    try {
        if (twilioAccountSid) {
            await twilioClient.messages.create({ body: `Your verification code is: ${otp}`, from: twilioPhoneNumber, to: fullMobile });
        }
        console.log(`--- OTP for ${fullMobile} is: ${otp} ---`); // Always log for dev
        res.json({ message: 'OTP sent successfully.' });
    } catch (err) {
        console.error("Twilio Error:", err.message);
        res.status(500).json({ message: 'Failed to send OTP.' });
    }
});

app.post('/api/guest/send-checkin-otp', async (req, res) => {
    const { countryCode, mobile } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const fullMobile = `${countryCode}${mobile}`;
    otpStore[fullMobile] = { otp, timestamp: Date.now() };
    console.log(`--- OTP for manual check-in ${fullMobile} is: ${otp} ---`);
    res.json({ message: "OTP sent to guest's mobile for verification." });
});

app.post('/api/guest/verify-otp', (req, res) => {
    const { countryCode, mobileNumber, otp } = req.body;
    const fullMobile = `${countryCode}${mobileNumber}`;
    const storedOtp = otpStore[fullMobile];
    if (storedOtp && storedOtp.otp === otp && (Date.now() - storedOtp.timestamp < 300000)) {
        delete otpStore[fullMobile];
        res.json({ success: true, message: 'OTP verified.' });
    } else {
        res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
    }
});


// --- Start Server ---
app.listen(port, () => {
  console.log(`🚀 Server listening on port ${port}`);
});