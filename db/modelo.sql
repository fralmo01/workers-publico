
CREATE TABLE RolesUsuario(
    
    id_rol INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    fecha_creacion TEXT DEFAULT (datetime("now")),
    estado_registro INTEGER NOT NULL,

    
    PRIMARY KEY (id_rol),
    UNIQUE (nombre),
    CHECK (estado_registro IN (0, 1)),
    CHECK (fecha_creacion <= datetime("now"))
)

CREATE TABLE Usuarios(
    
    id_usuario INTEGER NOT NULL,
    rol_usuario INTEGER NOT NULL,
    email VARCHAR(255) TEXT,
    fecha_creacion TEXT DEFAULT (datetime("now")),
    estado_registro INTEGER NOT NULL

    --las restricciones
    PRIMARY KEY (id_usuario),
    FOREIGN KEY (rol_usuario) REFERENCES RolesUsuario(id_rol),
    UNIQUE (email),
    CHECK (estado_registro IN (0, 1)),
    CHECK (fecha_creacion <= datetime("now"))
);

CREATE TABLE PerfilesEmpresa(
    
    id_perfil_empresa KEY NOT NULL,
    id_usuario INTEGER NOT NULL,
    razon_social TEXT NOT NULL,
    ruc TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    direccion TEXT NOT NULL,
    telefono TEXT NOT NULL,
    fecha_creacion TEXT DEFAULT (datetime("now")),
    estado_registro INTEGER NOT NULL,

    
    PRIMARY KEY (id_perfil_empresa),
    FOREIGN KEY (id_usuario) REFERENCES Usuarios(id_usuario),
    UNIQUE (id_usuario),
    UNIQUE (razon_social),
    UNIQUE (ruc) 
    CHECK (estado_registro IN (0, 1)),
    CHECK (fecha_creacion <= datetime("now"))
);

CREATE TABLE CategoriasTecnico(

   id_categoria_tenico INTEGER NOT NULL,
   nombre TEXT NOT NULL,
   descripcion TEXT NOT NULL,
   fecha_creacion TEXT DEFAULT (datetime("now")),
   estado_registro INTEGER NOT NULL,

   PRIMARY KEY (id_categoria_tecnico),
   UNIQUE (nombre),
   CHECK (estado_registro IN (0, 1)),
   CHECK (fecha_creacion <= datetime("now"))
);

CREATE TABLE PerfilesTecnico(
    
    id_perfil_tecnico INTEGER NOT NULL,
    id_usuario INTEGER NOT NULL,
    id_categoria_tecnico INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    apellido_paterno TEXT NOT NULL,
    apellido_materno TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    fecha_creacion TEXT DEFAULT (datetime("now")),
    estado_registro INTEGER NOT NULL,

    PRIMARY KEY (id_perfil_tecnico),
    FOREIGN KEY (id_usuario) REFERENCES Usuarios(id_usuario),
    FOREIGN KEY (id_categoria_tecnico) REFERENCES CategoriasTecnico(id_categoria_tecnico),
    UNIQUE (id_usuario),
    CHECK (estado_registro IN (0, 1)),
    CHECK (fecha_creacion <= datetime("now"))
);

CREATE TABLE TiposDocumento(
    id_tipo_documento INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    fecha_creacion TEXT DEFAULT (datetime("now")),
    estado_registro INTEGER NOT NULL,

    PRIMARY KEY (id_tipo_documento),
    UNIQUE (nombre),
    CHECK (estado_registro IN (0, 1)),
    CHECK (fecha_creacion <= datetime("now"))
);

CREATE TABLE Documento(
    id_documento INTEGER NOT NULL,
    id_tipo_documento INTEGER NOT NULL,
    id_usuario INTEGER NOT NULL,
    ruta_r2 TEXT NOT NULL,
    fecha_creacion TEXT DEFAULT (datetime("now")),
    estado_registro INTEGER NOT NULL,

    PRIMARY KEY (id_documento),
    FOREIGN KEY (id_tipo_documento) REFERENCES TiposDocumento(id_tipo_documento),
    FOREIGN KEY (id_usuario) REFERENCES Usuarios(id_usuario),
    CHECK (estado_registro IN (0, 1)),
    CHECK (fecha_creacion <= datetime("now"))
);

CREATE TABLE CategoriasEducacion(
    id_categoria_educacion INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    fecha_creacion TEXT DEFAULT (datetime("now")),
    estado_registro INTEGER NOT NULL,

    PRIMARY KEY (id_categoria_educacion),
    UNIQUE (nombre),
    CHECK (estado_registro IN (0, 1)),
    CHECK (fecha_creacion <= datetime("now"))
);

CREATE TABLE Educacion(
    id_educacion INTEGER NOT NULL,
    id_categoria_educacion INTEGER NOT NULL,
    id_usuario INTEGER NOT NULL,
    institucion TEXT NOT NULL,
    grado TEXT NOT NULL,
    fecha_inicio TEXT NOT NULL,
    fecha_fin TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    fecha_creacion TEXT DEFAULT (datetime("now")),
    estado_registro INTEGER NOT NULL,

    PRIMARY KEY (id_educacion),
    FOREIGN KEY (id_categoria_educacion) REFERENCES CategoriasEducacion(id_categoria_educacion),
    FOREIGN KEY (id_usuario) REFERENCES Usuarios(id_usuario),
    CHECK (estado_registro IN (0, 1)),
    CHECK (fecha_creacion <= datetime("now")),
    CHECK (fecha_inicio <= fecha_fin)
);

