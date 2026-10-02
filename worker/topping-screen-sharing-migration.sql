ALTER TABLE toppings ADD COLUMN screen_capture INTEGER NOT NULL DEFAULT 0 CHECK(screen_capture IN (0,1));
