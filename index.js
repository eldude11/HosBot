require('dotenv').config();
const { makeServer } = require('./src/server');

const PORT = process.env.PORT || 3000;
const app = makeServer();

app.listen(PORT, () => {
  console.log(`? Servidor listo: http://localhost:${PORT}`);
});
