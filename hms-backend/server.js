// Import required packages
const express = require('express');
require('dotenv').config(); // Load environment variables from .env file
const oracledb = require('oracledb');
const cors = require('cors');
const path = require('path');
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
    user: "hotel_admin",
    password: "myStrongPassword",
    connectString: "localhost:1521/XEPDB1"
};

// --- Server Configuration ---
const app = express();
const port = 3000;

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
    try {
        const maxRetries = 5;
        const retryDelay = 5000; // 5 seconds

        for (let i = 0; i < maxRetries; i++) {
            try {
                console.log(`Attempting to create Oracle connection pool (Attempt ${i + 1}/${maxRetries})...`);
                pool = await oracledb.createPool(dbConfig);
                console.log("✅ Oracle Database connection pool created successfully.");
                break;
            } catch (err) {
                if (i === maxRetries - 1) throw err;
                console.error(`❌ Connection failed: ${err.message}. Retrying in ${retryDelay / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }

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

        app.post('/api/online-bookings', async (req, res) => {
            const { guestName, email, roomType, hotelName } = req.body;
            if (!guestName || !email || !roomType || !hotelName) {
                return res.status(400).json({ message: 'Please complete all booking details (Name, Email, Room Type, Hotel).' });
            }

            const checkinOtp = Math.floor(100000 + Math.random() * 900000).toString();
            // Log the check-in OTP for simulation purposes
            console.log(`\n--- 🔑 Check-in OTP for booking by ${guestName} (${email}) is: ${checkinOtp} ---\n`);

            const sql = `INSERT INTO hms_online_bookings (guest_name, email, room_type, otp, hotel_name, mobile_number, country_code) 
                         VALUES (:guestName, :email, :roomType, :otp, :hotelName, '0000000000', '+00')
                         RETURNING booking_id INTO :bookingId`;
            
            const bind = {
                guestName,
                email: email || '',
                roomType,
                otp: checkinOtp,
                hotelName,
                bookingId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
            };

            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, bind, { autoCommit: true });
                const bookingId = result.outBinds.bookingId[0];
                res.status(201).json({ 
                    message: 'Room booked successfully!', 
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
            const sql = `SELECT booking_id, guest_name, email, room_type 
                         FROM hms_online_bookings 
                         WHERE hotel_name = :hotelName AND booking_status = 'Booked' 
                         ORDER BY booking_time ASC`;
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
                    `SELECT email FROM hms_online_bookings WHERE booking_id = :bookingId AND hotel_name = :hotelName AND booking_status = 'Booked'`,
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
            const { bookingId, guestOtp, hotelName, age, gender, verificationIdType, verificationId } = req.body;
            let connection;
            try {
                connection = await pool.getConnection();

                // 1. Verify OTP
                const bookingResult = await connection.execute( // This query doesn't need country_code, it's just for verification
                    `SELECT guest_name, email, room_type, otp FROM hms_online_bookings 
                     WHERE booking_id = :bookingId AND hotel_name = :hotelName AND booking_status = 'Booked'`,
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
                                    VALUES (:name, '+00', '0000000000', :email, :room, :checkIn, :hotel, :gender, :age, 'Online Booking', :verificationIdType, :verificationId)`;
                
                await connection.execute(checkInSql, {
                    name: booking.GUEST_NAME,
                    // countryCode and mobile are removed from input, passing empty strings
                    email: bookingDetails.rows[0].EMAIL,
                    room: assignedRoom,
                    checkIn: new Date(),
                    hotel: hotelName,
                    gender: gender,
                    age: age,
                    verificationIdType: verificationIdType,
                    verificationId: verificationId
                });
                
                // 4. Update the online booking status to 'Confirmed'
                await connection.execute(
                    `UPDATE hms_online_bookings SET booking_status = 'Confirmed' WHERE booking_id = :bookingId`,
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
            const { bookingId, hotelName } = req.body;
            let connection;
            try {
                connection = await pool.getConnection();

                // 1. Get guest's mobile number for notification
                const bookingResult = await connection.execute(
                    `SELECT email FROM hms_online_bookings 
                     WHERE booking_id = :bookingId AND hotel_name = :hotelName AND booking_status = 'Booked'`,
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
                const declineMessage = `We regret to inform you that your booking (ID: ${bookingId}) with ${hotelName} has been declined as all rooms are currently full.`;
                
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
            
            const sql = `INSERT INTO hms_users (full_name, username, password, email, mobile_number, role, address, hotel_name, perm_manage_rooms, perm_add_guests, perm_edit_guests) 
                         VALUES (:fullName, :username, :password, :email, :mobile, :role, :address, :hotelName, 0, 0, 0)`;
            let connection;
            try {
                connection = await pool.getConnection();
                await connection.execute(sql, {
                    fullName,
                    username,
                    password: tempPassword,
                    email: finalEmail,
                    mobile: finalMobile,
                    role,
                    address: address || '',
                    hotelName
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
            
            const sql = `SELECT user_id, full_name, username, role, address, hotel_name, email, mobile_number, perm_manage_rooms, perm_add_guests, perm_edit_guests 
                         FROM hms_users WHERE username = :username AND password = :password`;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, { username, password }, { 
                    outFormat: oracledb.OUT_FORMAT_OBJECT
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
                        permissions: {
                            manageRooms: dbUser.PERM_MANAGE_ROOMS === 1,
                            addGuests: dbUser.PERM_ADD_GUESTS === 1,
                            editGuests: dbUser.PERM_EDIT_GUESTS === 1
                        }
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
        // Get All Owners
        app.get('/api/admin/owners', async (req, res) => {
            const sql = `SELECT user_id, full_name, email, mobile_number, hotel_name, address FROM hms_users WHERE role = 'Owner' ORDER BY hotel_name`;
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

        // Delete Owner
        app.delete('/api/admin/owners/:user_id', async (req, res) => {
            const { user_id } = req.params;
            const sql = `DELETE FROM hms_users WHERE user_id = :user_id AND role = 'Owner'`;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, { user_id }, { autoCommit: true });
                res.json({ message: result.rowsAffected === 0 ? 'Owner not found.' : 'Owner deleted successfully.' });
            } catch (err) {
                console.error("Delete Owner Error:", err);
                res.status(500).json({ message: 'Failed to delete owner.' });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.get('/api/users', async (req, res) => {
            const { hotelName } = req.query;
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
            const sql = `SELECT user_id, full_name, username, role, address, hotel_name, email, mobile_number, profile_picture, perm_manage_rooms, perm_add_guests, perm_edit_guests 
                         FROM hms_users WHERE username = :username`;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, { username }, { 
                    outFormat: oracledb.OUT_FORMAT_OBJECT,
                    fetchInfo: { PROFILE_PICTURE: { type: oracledb.STRING } }
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
                        }
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
            const { fullName, email, mobile, address, role, profilePicture } = req.body;
            
            // Build dynamic query based on provided fields
            let updates = [];
            const binds = { user_id };

            if (fullName) { updates.push("full_name = :fullName"); binds.fullName = fullName; }
            if (email) { updates.push("email = :email"); binds.email = email; }
            if (mobile) { updates.push("mobile_number = :mobile"); binds.mobile = mobile; }
            if (address) { updates.push("address = :address"); binds.address = address; }
            if (role) { updates.push("role = :role"); binds.role = role; }
            if (profilePicture !== undefined) { updates.push("profile_picture = :profilePicture"); binds.profilePicture = profilePicture; }

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
            const sql = `SELECT room_id, room_type, room_number, cost_per_hour, cost_per_day, discount_percent, photos FROM hms_rooms WHERE hotel_name = :hotelName ORDER BY room_number`;
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
            const { guestId, hotelName } = req.body;
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

                const historySql = `INSERT INTO hms_bill_history (guest_name, room_number, check_in_time, check_out_time, total_hours, gross_amount, discount_amount, final_amount, hotel_name) 
                                    VALUES (:name, :room, :checkIn, :checkOut, :hours, :gross, :discount, :final, :hotel)`;
                await connection.execute(historySql, {
                    name: guest.GUEST_NAME,
                    room: guest.ROOM_NUMBER,
                    checkIn: guest.CHECK_IN_TIME,
                    checkOut: checkOut,
                    hours: hours,
                    gross: grossAmount,
                    discount: discountAmount,
                    final: finalAmount,
                    hotel: hotelName
                });

                await connection.execute(
                    `DELETE FROM hms_guests WHERE guest_id = :guestId AND hotel_name = :hotelName`,
                    { guestId, hotelName }
                );
                
                await connection.commit();
                res.json({ message: 'Checkout successful!', finalAmount: finalAmount });

            } catch (err) {
                console.error("Checkout Error:", err);
                if (connection) await connection.rollback();
                res.status(500).json({ message: 'Checkout failed: ' + err.message });
            } finally {
                if (connection) await connection.close();
            }
        });

        app.get('/api/history', async (req, res) => {
            const { hotelName } = req.query;
            const sql = `SELECT * FROM hms_bill_history WHERE hotel_name = :hotelName ORDER BY check_out_time DESC`;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, { hotelName }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
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
                const { status, roomNumber } = req.query;
                
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
                const { roomNumber, items, totalCost } = req.body;
                
                const sql = `
                    INSERT INTO food_orders (room_number, items, total_cost, status)
                    VALUES (:roomNumber, :items, :totalCost, 'Pending')
                    RETURNING id INTO :id
                `;
                
                const result = await connection.execute(sql, {
                    roomNumber,
                    items: JSON.stringify(items),
                    totalCost,
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
            const { roomNumber, requestType, comments } = req.body;
            let connection;
            try {
                connection = await pool.getConnection();
                const sql = `INSERT INTO service_requests (room_number, request_type, comments, status) 
                             VALUES (:roomNumber, :requestType, :comments, 'Pending')`;
                await connection.execute(sql, { roomNumber, requestType, comments: comments || '' }, { autoCommit: true });
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

        // --- Menu Management Routes ---
        app.get('/api/menu', async (req, res) => {
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(
                    `SELECT id, name, price, image_url, NVL(is_available, 1) as is_available, category FROM food_menu ORDER BY category, name`,
                    [],
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
            const { name, price, imageUrl, category } = req.body;
            let connection;
            try {
                connection = await pool.getConnection();
                await connection.execute(
                    `INSERT INTO food_menu (name, price, image_url, category) VALUES (:name, :price, :imageUrl, :category)`,
                    { name, price, imageUrl: imageUrl || '', category: category || 'Main Course' },
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
            const { items } = req.body; // Array of { name, price, category, imageUrl }
            if (!items || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ message: 'No items provided.' });
            }

            let connection;
            try {
                connection = await pool.getConnection();
                const sql = `INSERT INTO food_menu (name, price, image_url, category) VALUES (:name, :price, :imageUrl, :category)`;
                const binds = items.map(i => ({
                    name: i.name,
                    price: i.price,
                    imageUrl: i.imageUrl || '',
                    category: i.category || 'Main Course'
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

        // --- Start the Express Server ---
        const server = app.listen(port, () => {
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



// Run the server
startServer();