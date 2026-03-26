FROM node:20-bookworm-slim

# Thiết lập thư mục làm việc
WORKDIR /app

# Chỉ copy package.json trước để tận dụng Docker cache
COPY package*.json ./

# Cài đặt các thư viện Node.js (Express, Playwright...)
RUN npm install

# Cài đặt trình duyệt Chromium và các thư viện hệ điều hành cần thiết cho Playwright
RUN npx playwright install --with-deps chromium

# Copy toàn bộ mã nguồn còn lại vào image
COPY . .

# Mở cổng 3000 để truy cập API
EXPOSE 3000

# Lệnh khởi chạy server Node.js
CMD ["node", "server.js"]
