#Base Image: Debian Bookworm with Python 3.11 pre-installed
FROM python:3.11-bookworm

#Environment Variables
#Prevents Python from buffering stdout and stderr
ENV PYTHONUNBUFFERED=1 
#Prevents Puppeteer from downloading its own version of Chromium (saves space/time)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
#Tells Puppeteer where to find the system-installed Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

#Install System Dependencies
#Node.js, Chromium, and all the shared libraries Chromium requires to run headless
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    chromium \
    fonts-liberation \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 \
    #Setup NodeSource repository for Node.js 18.x
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    #Node.js
    && apt-get install -y nodejs \
    #Clean up
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

#Install Python Dependencies
COPY requirements_frozen.txt .
RUN pip install --no-cache-dir -r requirements_frozen.txt

#Install Node.js Dependencies
COPY package.json package-lock.json* ./
RUN npm install

#Copy the rest of the application code
COPY . .

#Defining the default command to run when the container starts
ENTRYPOINT ["python", "main.py"]