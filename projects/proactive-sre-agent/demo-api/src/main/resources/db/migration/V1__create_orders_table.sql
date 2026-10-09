CREATE TABLE orders (
    id UUID PRIMARY KEY,
    customer_name VARCHAR(255) NOT NULL,
    item VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
