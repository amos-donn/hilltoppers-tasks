ALTER TABLE toppings ADD COLUMN height_mode TEXT NOT NULL DEFAULT 'fixed' CHECK(height_mode IN ('fixed','content'));
