# Guía de Despliegue en Easypanel

Esta guía te ayudará a subir tu **Fidelizador Bot** a Easypanel paso a paso y conectar la extensión de Chrome.

---

## 1. Actualizar tu Repositorio en GitHub

Como he realizado cambios en el código (agregando un `Dockerfile` y limpiando la URL de prueba), primero debes actualizar tu repositorio.

1.  Copia los archivos que he generado (`server/Dockerfile`, `extension/content.js`, etc.) a tu carpeta local.
2.  Abre una terminal en tu carpeta del proyecto.
3.  Ejecuta los siguientes comandos para subir todo a GitHub:

    ```bash
    git add .
    git commit -m "Preparando despliegue para Easypanel"
    git push origin main
    ```

---

## 2. Crear el Proyecto en Easypanel

1.  Entra a tu panel de **Easypanel**.
2.  Haz clic en el botón **"Create Project"** (o usa uno existente).
3.  Ponle un nombre, por ejemplo: `Fidelizador`.

---

## 3. Crear el Servicio (App)

1.  Dentro del proyecto, haz clic en **"+ Service"** y elige **"App"**.
2.  En **Source** (Fuente), selecciona **GitHub**.
3.  Busca y selecciona tu repositorio: `bernabe05rodriguez-stack/fidelizador-bot`.
4.  **IMPORTANTE:** Configura los siguientes campos:
    *   **Root Directory:** Escribe `/server` (porque el código del servidor está en esa subcarpeta).
    *   **Build Method:** Debería detectar `Dockerfile` automáticamente (gracias al archivo que creamos). Si no, selecciónalo manualmente.
    *   **Port:** Asegúrate de que esté en `3000` (es el valor por defecto en nuestro código).
5.  Haz clic en **"Create"** o **"Deploy"**.

Easypanel comenzará a construir tu aplicación. Esto puede tardar unos minutos la primera vez.

---

## 4. Obtener tu URL Pública

1.  Una vez que el despliegue termine y salga en **verde (Running)**.
2.  Busca la sección de **"Domains"** o haz clic en el botón **"Open"** en Easypanel.
3.  Se abrirá una nueva pestaña con tu servidor. Copia esa URL de la barra de direcciones.
    *   Debería verse algo como: `https://fidelizador.tudominio.easypanel.host` (o similar).

---

## 5. Conectar la Extensión

1.  Abre el archivo `extension/content.js` en tu computadora (con VS Code o Bloc de notas).
2.  Busca la línea que dice:
    ```javascript
    const URL_SERVIDOR = "PONER_TU_URL_AQUI";
    ```
3.  Reemplaza `PONER_TU_URL_AQUI` con la URL que copiaste en el paso anterior.
    *   Ejemplo final:
        ```javascript
        const URL_SERVIDOR = "https://fidelizador.bm6z1s.easypanel.host";
        ```
    *(¡Ojo! No olvides borrar la barra `/` del final si la tiene, aunque suele funcionar igual)*.

4.  Guarda el archivo.
5.  Ve a Chrome -> **Extensiones** (`chrome://extensions/`).
6.  Busca tu extensión "Bot Fidelizador" y haz clic en el botón de **Recargar** (flecha circular) o elimínala y vuélvela a cargar ("Cargar descomprimida").

---

## ¡Listo! 🚀

Ahora tu extensión debería conectarse automáticamente a tu propio servidor en Easypanel.

*   Abre WhatsApp Web.
*   Abre el popup de la extensión, pon tu número y sala.
*   En la consola de Chrome (F12) deberías ver: `✅ Conectado a Sala: ...`
