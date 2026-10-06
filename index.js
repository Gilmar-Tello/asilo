const express = require('express');
//creacion apliacion/servidor
const app = express();
//leera los datos en formato json
app.use(express.json());
//microservicio: calcular costo
app.post('/calcular-costo', (req, res) => {
    //recibe los costos
    const { consulta, examenes, medicamentos } = req.body;

    //suma todo
    const subtotal = consulta + examenes + medicamentos;

    //descuento ficticio de la fundacion 20%
    const descuento = subtotal * 0.20;
    const total = subtotal - descuento;

    //resultado
    res.json({
        subtotal: subtotal,
        descuento: descuento,
        total: total
    });
});

//abre el microservicio en el puerto 3000
app.listen(3000, () => {
    console.log('Microservicio de calcular costo corre en http://localhost:3000');
});