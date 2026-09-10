-- El registro de usuarios está restringido: todas las cuentas existentes fueron
-- provisionadas por un administrador. El acceso continúa protegido por OTP o contraseña.
UPDATE `users`
SET `email_verified` = true
WHERE `email_verified` = false;
