-- PostgreSQL mirror of the PhotoGit semantic model (packages/schema, SCHEMA_VERSION 1).
-- Git stays the source of truth; these tables hold one project state per project
-- so it can be queried. Limits and ranges follow the validators in
-- packages/schema/src/index.ts.
--
-- Load with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql

BEGIN;

CREATE TABLE IF NOT EXISTS projects (
  project_id     text PRIMARY KEY CHECK (char_length(project_id) BETWEEN 1 AND 500),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  display_name   text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 1024),
  created_with   text NOT NULL CHECK (char_length(created_with) BETWEEN 1 AND 200)
);

-- DocumentDomain: one document per project state.
CREATE TABLE IF NOT EXISTS documents (
  project_id           text PRIMARY KEY REFERENCES projects (project_id) ON DELETE CASCADE,
  schema_version       integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  document_id          text NOT NULL CHECK (char_length(document_id) BETWEEN 1 AND 500),
  name                 text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 1024),
  width                double precision NOT NULL CHECK (width > 0),
  height               double precision NOT NULL CHECK (height > 0),
  resolution           double precision NOT NULL CHECK (resolution > 0),
  mode                 text NOT NULL CHECK (char_length(mode) BETWEEN 1 AND 100),
  bit_depth            integer NOT NULL CHECK (bit_depth >= 1),
  color_profile        text CHECK (char_length(color_profile) <= 1024),
  rendered_fingerprint text CHECK (char_length(rendered_fingerprint) <= 10000),
  compatibility        text NOT NULL CHECK (compatibility IN ('supported', 'limited')),
  warnings             text[] NOT NULL DEFAULT '{}'
);

-- StructureDomain.layers. Roots are the rows with a NULL parent_uuid; children
-- are the rows pointing back at a layer, ordered by layer_order.
CREATE TABLE IF NOT EXISTS layers (
  project_id   text NOT NULL REFERENCES projects (project_id) ON DELETE CASCADE,
  uuid         text NOT NULL CHECK (uuid ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'),
  photoshop_id bigint NOT NULL CHECK (photoshop_id >= 1),
  parent_uuid  text,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 1024),
  kind         text NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 100),
  layer_order  integer NOT NULL CHECK (layer_order >= 0),
  PRIMARY KEY (project_id, uuid),
  UNIQUE (project_id, photoshop_id),
  FOREIGN KEY (project_id, parent_uuid) REFERENCES layers (project_id, uuid)
    ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CHECK (parent_uuid IS DISTINCT FROM uuid)
);

CREATE INDEX IF NOT EXISTS layers_parent_idx ON layers (project_id, parent_uuid, layer_order);

-- IdentitiesDomain.records. photoshopId and parentUuid must equal the layer's,
-- so they are read from layers rather than stored twice.
CREATE TABLE IF NOT EXISTS layer_identities (
  project_id text NOT NULL,
  layer_uuid text NOT NULL,
  signature  text NOT NULL CHECK (char_length(signature) BETWEEN 1 AND 10000),
  confidence text NOT NULL CHECK (confidence IN ('exact', 'confirmed', 'uncertain')),
  PRIMARY KEY (project_id, layer_uuid),
  FOREIGN KEY (project_id, layer_uuid) REFERENCES layers (project_id, uuid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS layer_appearance (
  project_id               text NOT NULL,
  layer_uuid               text NOT NULL,
  schema_version           integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  visible                  boolean NOT NULL,
  opacity                  double precision NOT NULL CHECK (opacity BETWEEN 0 AND 100),
  fill_opacity             double precision NOT NULL CHECK (fill_opacity BETWEEN 0 AND 100),
  blend_mode               text NOT NULL CHECK (char_length(blend_mode) BETWEEN 1 AND 100),
  clipped                  boolean NOT NULL,
  lock_all                 boolean NOT NULL,
  lock_pixels              boolean NOT NULL,
  lock_position            boolean NOT NULL,
  lock_transparent_pixels  boolean NOT NULL,
  bounds_left              double precision NOT NULL,
  bounds_top               double precision NOT NULL,
  bounds_right             double precision NOT NULL,
  bounds_bottom            double precision NOT NULL,
  bounds_no_effects_left   double precision NOT NULL,
  bounds_no_effects_top    double precision NOT NULL,
  bounds_no_effects_right  double precision NOT NULL,
  bounds_no_effects_bottom double precision NOT NULL,
  PRIMARY KEY (project_id, layer_uuid),
  FOREIGN KEY (project_id, layer_uuid) REFERENCES layers (project_id, uuid) ON DELETE CASCADE,
  CHECK (bounds_left <= bounds_right AND bounds_top <= bounds_bottom),
  CHECK (bounds_no_effects_left <= bounds_no_effects_right AND bounds_no_effects_top <= bounds_no_effects_bottom)
);

-- TextDomain: present only for text layers.
CREATE TABLE IF NOT EXISTS layer_text (
  project_id        text NOT NULL,
  layer_uuid        text NOT NULL,
  schema_version    integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  contents          text NOT NULL CHECK (char_length(contents) <= 1000000),
  style_fingerprint text,
  PRIMARY KEY (project_id, layer_uuid),
  FOREIGN KEY (project_id, layer_uuid) REFERENCES layers (project_id, uuid) ON DELETE CASCADE
);

-- ContentDomain. details holds the scalar LayerDetails map; NULL for versions
-- saved before details were captured.
CREATE TABLE IF NOT EXISTS layer_content (
  project_id     text NOT NULL,
  layer_uuid     text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  fingerprint    text,
  opaque         boolean NOT NULL,
  reason         text,
  details        jsonb CHECK (details IS NULL OR jsonb_typeof(details) = 'object'),
  PRIMARY KEY (project_id, layer_uuid),
  FOREIGN KEY (project_id, layer_uuid) REFERENCES layers (project_id, uuid) ON DELETE CASCADE
);

COMMIT;
