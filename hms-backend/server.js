// Import required packages
const express = require('express');
require('dotenv').config(); // Load environment variables from .env file
const oracledb = require('oracledb');
const cors = require('cors');
const path = require('path'); // <-- KEEP THIS

// --- Oracle Instant Client Initialization ---
try {
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

// ✅ IMPORTANT FOR RENDER:
const PORT = process.env.PORT || 3000;

// Twilio (optional)
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const twilioClient = require('twilio')(twilioAccountSid, twilioAuthToken);

// Middleware
app.use(cors());
app.use(express.json());

// Serve Static Files
app.use(express.static(path.join(__dirname, '..')));

// In-memory OTP store
const otpStore = {};

// Public Booking Route (serves guest.html)
app.get('/book/:hotelName', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'guest.html'));
});

// ✅ Health Check (Required by Render)
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});ss
// --- Database & Server Initialization ---
async function startServer() {
    let pool;
    try {
        console.log("Attempting to create Oracle connection pool...");
        pool = await oracledb.createPool(dbConfig);
        console.log("✅ Oracle Database connection pool created successfully.");

        // --- Configuration Validation ---
        /*if (!twilioAccountSid || !twilioAuthToken || !twilioPhoneNumber) {
            console.error("\n❌ FATAL ERROR: Twilio credentials are not configured.");
            console.error("Please create a '.env' file in the 'hms-backend' directory with your credentials:");
            console.error("-------------------------------------------------");
            console.error("TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
            console.error("TWILIO_AUTH_TOKEN=your_auth_token");
            console.error("TWILIO_PHONE_NUMBER=+12345678901");
            console.error("-------------------------------------------------\n");
            throw new Error("Twilio configuration is missing. Server startup aborted.");
        }*/

        // --- API ROUTES ---

        // --- GUEST AUTH & BOOKING ROUTES ---

        app.post('/api/guest/send-otp', async (req, res) => {
            const { countryCode, mobileNumber } = req.body;
            if (!countryCode || !mobileNumber || !/^\d{10}$/.test(mobileNumber)) {
                return res.status(400).json({ message: 'A valid country code and 10-digit mobile number are required.' });
            }
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const fullMobile = `${countryCode}${mobileNumber}`;
            otpStore[fullMobile] = { otp: otp, timestamp: Date.now() };
        
            // --- OTP Sending Disabled ---
            // The following block is commented out to prevent sending a real SMS.
            // The OTP is logged to the server console for development and testing.
            // await twilioClient.messages.create({
            //     body: `Your HMS verification code is: ${otp}`,
            //     from: twilioPhoneNumber,
            //     to: fullMobile
            // });
            console.log(`\n--- 📞 [DEV] OTP for guest login ${fullMobile} is: ${otp} ---\n`);
            res.json({ message: 'OTP has been sent to your mobile number.' });
        });

        app.post('/api/guest/verify-otp', (req, res) => {
            const { countryCode, mobileNumber, otp } = req.body;
            const fullMobile = `${countryCode}${mobileNumber}`;
            const storedOtpData = otpStore[fullMobile];
            const fiveMinutes = 5 * 60 * 1000;

            if (storedOtpData && storedOtpData.otp === otp && (Date.now() - storedOtpData.timestamp < fiveMinutes)) {
                delete otpStore[fullMobile]; // OTP is single-use
                res.json({ success: true, message: 'OTP verified successfully.' });
            } else {
                res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
            }
        });

        app.post('/api/online-bookings', async (req, res) => {
            const { guestName, countryCode, mobileNumber, roomType, hotelName } = req.body;
            if (!guestName || !countryCode || !mobileNumber || !roomType || !hotelName) {
                return res.status(400).json({ message: 'Guest name, country code, mobile, room type, and hotel are required.' });
            }

            // --- ⭐️ NEW: Check if hotel exists before booking ---
            let connection;
            try {
                connection = await pool.getConnection();

                const hotelCheck = await connection.execute(
                    `SELECT COUNT(*) AS count FROM hms_users WHERE hotel_name = :hotelName AND ROWNUM = 1`,
                    { hotelName }
                );
        
                if (hotelCheck.rows[0][0] === 0) {
                     // Using ROWS[0][0] for COUNT(*)
                    return res.status(404).json({ message: 'This hotel does not exist.' });
                }

                const checkinOtp = Math.floor(100000 + Math.random() * 900000).toString();
                // Log the check-in OTP for simulation purposes
                console.log(`\n--- 🔑 Check-in OTP for booking by ${guestName} (${mobileNumber}) is: ${checkinOtp} ---\n`);

                const sql = `INSERT INTO hms_online_bookings (guest_name, country_code, mobile_number, room_type, otp, hotel_name) 
                            VALUES (:guestName, :countryCode, :mobileNumber, :roomType, :otp, :hotelName)
                            RETURNING booking_id INTO :bookingId`;
                
                const bind = {
                    guestName,
                    countryCode,
                    mobileNumber,
                    roomType,
                    otp: checkinOtp,
                    hotelName,
                    bookingId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
                };

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
            const sql = `SELECT booking_id, guest_name, country_code, mobile_number, room_type 
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
                    `SELECT country_code, mobile_number FROM hms_online_bookings WHERE booking_id = :bookingId AND hotel_name = :hotelName AND booking_status = 'Booked'`,
                    { bookingId, hotelName },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );

                if (bookingResult.rows.length === 0) {
                    return res.status(404).json({ message: 'Booking not found or already processed.' });
                }

                const booking = bookingResult.rows[0];
                const fullMobile = `${booking.COUNTRY_CODE}${booking.MOBILE_NUMBER}`;
                const checkinOtp = Math.floor(100000 + Math.random() * 900000).toString();

                await connection.execute(
                    `UPDATE hms_online_bookings SET otp = :otp WHERE booking_id = :bookingId`,
                    { otp: checkinOtp, bookingId },
                    { autoCommit: true }
                );

                console.log(`\n--- 🔑 [DEV] Acceptance OTP for booking #${bookingId} (${fullMobile}) is: ${checkinOtp} ---\n`);
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
                    `SELECT guest_name, mobile_number, room_type, otp FROM hms_online_bookings 
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
                    `SELECT country_code, mobile_number FROM hms_online_bookings WHERE booking_id = :bookingId AND hotel_name = :hotelName`, 
                    { bookingId, hotelName }, 
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                const checkInSql = `INSERT INTO hms_guests (guest_name, country_code, mobile_number, room_number, check_in_time, hotel_name, gender, age, address, verification_id_type, verification_id) 
                            VALUES (:name, :countryCode, :mobile, :room, :checkIn, :hotel, :gender, :age, 'Online Booking', :verificationIdType, :verificationId)`;
                await connection.execute(checkInSql, {
                    name: booking.GUEST_NAME,
                    countryCode: bookingDetails.rows[0].COUNTRY_CODE,
                    mobile: bookingDetails.rows[0].MOBILE_NUMBER,
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
                    `SELECT country_code, mobile_number FROM hms_online_bookings 
                     WHERE booking_id = :bookingId AND hotel_name = :hotelName AND booking_status = 'Booked'`,
                    { bookingId, hotelName },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );

                if (bookingResult.rows.length === 0) {
                    return res.status(404).json({ message: 'Booking not found or already processed.' });
                }
                const booking = bookingResult.rows[0];
                const fullMobile = `${booking.COUNTRY_CODE}${booking.MOBILE_NUMBER}`;

                // 2. Update the booking status to 'Declined'
                await connection.execute(
                    `UPDATE hms_online_bookings SET booking_status = 'Declined' WHERE booking_id = :bookingId`,
                    { bookingId }, 
                    { autoCommit: true }
                );

                // 3. Send a notification to the guest (simulated via console log)
                const declineMessage = `We regret to inform you that your booking (ID: ${bookingId}) with ${hotelName} has been declined as all rooms are currently full.`;
                console.log(`\n--- 📤 [DEV] Decline notification for ${fullMobile}: "${declineMessage}" ---\n`);
                // --- SMS Sending Disabled ---
                // await twilioClient.messages.create({ 
                //    body: declineMessage, 
                //    from: twilioPhoneNumber, to: fullMobile 
                // });

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
                    `SELECT room_number, room_type FROM hms_rooms WHERE hotel_name = :hotelName`,
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

        // New endpoint for sending OTP during manual check-in
        app.post('/api/guest/send-checkin-otp', async (req, res) => {
            const { countryCode, mobile } = req.body;
            if (!countryCode || !mobile || !/^\d{10}$/.test(mobile)) {
                return res.status(400).json({ message: 'A valid country code and 10-digit mobile number are required.' });
            }
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const fullMobile = `${countryCode}${mobile}`;
            otpStore[fullMobile] = { otp, timestamp: Date.now() };

            // --- OTP Sending Disabled ---
            // The following block is commented out to prevent sending a real SMS.
            // The OTP is logged to the server console for development and testing.
            // await twilioClient.messages.create({
            //     body: `Your check-in verification code is: ${otp}`,
            //     from: twilioPhoneNumber,
            //     to: fullMobile
            // });
            console.log(`\n--- 🔑 [DEV] OTP for manual check-in ${fullMobile} is: ${otp} ---\n`);
            res.json({ message: 'OTP sent to guest for verification.' });
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
            const { fullName, username, password, role, address, hotelName } = req.body;
            
            if (!fullName || !username || !password || !role || !hotelName) {
                return res.status(400).json({ message: 'All fields are required.' });
            }
            
            const sql = `INSERT INTO hms_users (full_name, username, password, role, address, hotel_name, perm_manage_rooms, perm_add_guests, perm_edit_guests) 
                         VALUES (:fullName, :username, :password, :role, :address, :hotelName, 0, 0, 0)`;
            let connection;
            try {
                connection = await pool.getConnection();
                await connection.execute(sql, {
                    fullName,
                    username,
                    password,
                    role,
                    address: address || '',
                    hotelName
                }, { autoCommit: true });
                res.status(201).json({ message: 'User registered successfully!' });
            } catch (err) {
                console.error("Registration Error:", err);
                if (err.errorNum === 1) {
                    res.status(409).json({ message: 'Username already exists.' });
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
            
            const sql = `SELECT user_id, full_name, username, role, address, hotel_name, perm_manage_rooms, perm_add_guests, perm_edit_guests 
                         FROM hms_users WHERE username = :username AND password = :password`;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, { username, password }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
                
                if (result.rows.length > 0) {
                    const dbUser = result.rows[0];
                    const user = {
                        userId: dbUser.USER_ID,
                        fullName: dbUser.FULL_NAME,
                        username: dbUser.USERNAME,
                        role: dbUser.ROLE,
                        address: dbUser.ADDRESS,
                        hotelName: dbUser.HOTEL_NAME,
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

        app.get('/api/users', async (req, res) => {
            const { hotelName } = req.query;
            const sql = `SELECT user_id, full_name, username, role, address, hotel_name, perm_manage_rooms, perm_add_guests, perm_edit_guests 
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

        // FIXED: Rewritten permission update endpoint for correctness and security
        const permissionColumnMap = {
            manageRooms: 'PERM_MANAGE_ROOMS',
            addGuests: 'PERM_ADD_GUESTS',
            editGuests: 'PERM_EDIT_GUESTS'
        };

        app.put('/api/users/:user_id/permissions', async (req, res) => {
            const { user_id } = req.params;
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

        app.post('/api/rooms', async (req, res) => {
            const { type, number, costHour, costDay, discount, hotelName } = req.body;
            const sql = `INSERT INTO hms_rooms (room_type, room_number, cost_per_hour, cost_per_day, discount_percent, hotel_name) 
                         VALUES (:roomType, :roomNumber, :costHour, :costDay, :discount, :hotelName)`;
            let connection;
            try {
                connection = await pool.getConnection();
                await connection.execute(sql, {
                    roomType: type,
                    roomNumber: number,
                    costHour: costHour,
                    costDay: costDay,
                    discount: discount || 0,
                    hotelName: hotelName
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
            const { type, costHour, costDay, discount, hotelName } = req.body;
            const sql = `UPDATE hms_rooms SET room_type = :type, cost_per_hour = :costHour, cost_per_day = :costDay, discount_percent = :discount 
                         WHERE room_number = :room_number AND hotel_name = :hotelName`;
            let connection;
            try {
                connection = await pool.getConnection();
                const result = await connection.execute(sql, {
                    type,
                    costHour,
                    costDay,
                    discount,
                    room_number,
                    hotelName
                }, { autoCommit: true });
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
            const sql = `SELECT g.guest_id, g.guest_name, g.age, g.gender, g.country_code, g.mobile_number, g.room_number, g.check_in_time, g.address, g.verification_id_type, g.verification_id,
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
            const { name, age, gender, countryCode, mobile, room, checkIn, address, hotelName, verificationIdType, verificationId, otp } = req.body;
            
            // OTP Verification for new guests
            const fullMobile = `${countryCode}${mobile}`;
            const storedOtpData = otpStore[fullMobile];
            const fiveMinutes = 5 * 60 * 1000;

            if (!storedOtpData || storedOtpData.otp !== otp || (Date.now() - storedOtpData.timestamp > fiveMinutes)) {
                return res.status(400).json({ message: 'Invalid or expired OTP.' });
            }
            delete otpStore[fullMobile]; // OTP is single-use

            const sql = `INSERT INTO hms_guests (guest_name, age, gender, country_code, mobile_number, room_number, check_in_time, address, hotel_name, verification_id_type, verification_id) 
                         VALUES (:name, :age, :gender, :countryCode, :mobile, :room, TO_TIMESTAMP(:checkIn, 'YYYY-MM-DD"T"HH24:MI'), :address, :hotelName, :verificationIdType, :verificationId)`;
            let connection;

            try {
                connection = await pool.getConnection();
                await connection.execute(sql, {
                    name,
                    age,
                    gender,
                    countryCode,
                    mobile,
                    room,
                    checkIn,
                    address,
                    hotelName,
                    verificationIdType,
                    verificationId
                }, { autoCommit: true });
                res.status(201).json({ message: 'Guest checked in successfully.' });
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
            const { name, age, gender, countryCode, mobile, room, checkIn, address, hotelName, verificationIdType, verificationId } = req.body;
            const sql = `UPDATE hms_guests SET guest_name = :name, age = :age, gender = :gender, country_code = :countryCode, mobile_number = :mobile, 
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

        // --- Start the Express Server ---
        app.listen(port, () => {
            console.log(`🚀 Server running on http://localhost:${port}`);
            console.log(`✅ Staff login available at http://localhost:${port}/index.html`);
            console.log(`✅ Guest booking example: http://localhost:${port}/book/Your-Hotel-Name`);
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
}

// --- Graceful Shutdown ---
async function closePoolAndExit() {
  console.log('\nClosing connection pool...');
  try {
    await oracledb.getPool().close(10);
    console.log('Pool closed');
    process.exit(0);
  } catch (err) {
    console.error('Error closing pool', err);
    process.exit(1);
  }
}

process.once('SIGTERM', closePoolAndExit).once('SIGINT', closePoolAndExit);

// Run the server
startServer();