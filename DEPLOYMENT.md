# Deployment Guide

This guide explains how to deploy the Hotel Management System on Linux and Windows servers.

## Prerequisites for All Servers
1.  **Node.js**: Install Node.js (LTS version recommended) from [nodejs.org](https://nodejs.org/).
2.  **Oracle Instant Client**: Required for the `oracledb` driver to connect to your database.
    *   **Linux**: Install `libaio1` and download the Basic Instant Client ZIP. Unzip it and set `LD_LIBRARY_PATH`.
    *   **Windows**: Download the Basic Instant Client ZIP. Unzip it and add the directory to your system `PATH` environment variable.
3.  **Database**: Ensure your Oracle Database is accessible from these servers (check firewalls/security groups).

## Deployment Steps

### 1. Prepare the Code
Upload your code to GitHub or copy it to the servers.

### 2. Linux Server Setup (x2)
Run the following commands in your terminal:

```bash
# 1. Clone your repository
git clone https://github.com/Leadapps/Hotel_Management_System.git
cd Hotel_Management_System/hms-backend

# 2. Install dependencies
npm install

# 3. Configure Environment Variables
# Create a .env file with your production details
echo "DB_USER=DMIN to that folder path.
echo "TNS_ADMIN=C:\oracle\wallet" >> .env

# 4. Set DB_CONNECT_STRING to the service name found in tnsnames.ora (inside the wallet)
#    Example: myhoteldb_high
echo "DB_CONNECT_STRING=myhoteldb_high" >> .env

echo "PORT=80" >> .env
echo "EMAIL_USER=hotel@example.com" >> .env
echo "EMAIL_PASS=email_password" >> .env

# 4. Start the Server (using PM2 for process management)
sudo npm install -g pm2
pm2 start server.js --name "hms-app"
pm2 save
pm2 startup
```

### 3. Windows Server Setup (x2)
1.  **Open PowerShell** as Administrator.
2.  **Clone/Copy code** to a folder (e.g., `C:\Apps\HMS`).
    ```powershell
    git clone https://github.com/Leadapps/Hotel_Management_System.git C:\Apps\HMS
    ```
3.  **Install dependencies**:
    ```powershell
    cd C:\Apps\HMS\hms-backend
    npm install
    ```
4.  **Configure Environment**:
    Create a `.env` file in `hms-backend` with your Windows-specific DB credentials.
5.  **Start the Server**:
    You can use `pm2` on Windows as well, or run it directly:
    ```powershell
    npm install -g pm2
    pm2 start server.js --name "hms-app"
    ```

## Load Balancing (Optional)
Since you have 4 servers, you likely want a Load Balancer (like Nginx, HAProxy, or an AWS Application Load Balancer) sitting in front of them to distribute traffic:

*   **Traffic** -> **Load Balancer** -> **Linux Server 1 / Linux Server 2 / Windows Server 1 / Windows Server 2**

Ensure all servers connect to the **same** Oracle Database instance so data is consistent.

## Database Initialization
The application is configured to automatically check for and create required database tables (Schema Migration) upon the first successful startup. Ensure the database user provided in the `.env` file has permissions to `CREATE TABLE` and `ALTER TABLE`.