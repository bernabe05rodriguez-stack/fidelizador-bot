FROM node:18-alpine

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar el resto del código
COPY . .

# Exponer el puerto que usa la app (por defecto 3000, pero Easypanel lo gestiona)
EXPOSE 3000

# Comando para iniciar la aplicación
CMD ["npm", "start"]
