--
-- PostgreSQL database dump
--

\restrict Bj3OfosX12qBer5YTf1v0vlzSz5g5fP926wRz1OKKr5jUhXX6KMZ4lT0p0FU0nS

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account_transactions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.account_transactions (
    id integer NOT NULL,
    receipt_no text,
    account_id integer NOT NULL,
    direction text NOT NULL,
    amount numeric(14,2) NOT NULL,
    mode text DEFAULT 'cash'::text NOT NULL,
    party_name text,
    notes text,
    created_by_id integer,
    created_by_name text,
    created_by_role text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    party_mobile text,
    party_entity_id integer,
    company_id integer NOT NULL
);


ALTER TABLE public.account_transactions OWNER TO postgres;

--
-- Name: account_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.account_transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.account_transactions_id_seq OWNER TO postgres;

--
-- Name: account_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.account_transactions_id_seq OWNED BY public.account_transactions.id;


--
-- Name: accounts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.accounts (
    id integer NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    identifier text,
    opening_balance numeric(14,2) DEFAULT 0 NOT NULL,
    current_balance numeric(14,2) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.accounts OWNER TO postgres;

--
-- Name: accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.accounts_id_seq OWNER TO postgres;

--
-- Name: accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.accounts_id_seq OWNED BY public.accounts.id;


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id integer NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.app_settings OWNER TO postgres;

--
-- Name: app_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.app_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.app_settings_id_seq OWNER TO postgres;

--
-- Name: app_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.app_settings_id_seq OWNED BY public.app_settings.id;


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_log (
    id integer NOT NULL,
    action text NOT NULL,
    description text,
    user_id integer NOT NULL,
    user_name text,
    metadata text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.audit_log OWNER TO postgres;

--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.audit_log_id_seq OWNER TO postgres;

--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: bom_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bom_items (
    id integer NOT NULL,
    bom_id integer NOT NULL,
    material_product_id integer NOT NULL,
    quantity numeric(12,3) NOT NULL,
    unit text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.bom_items OWNER TO postgres;

--
-- Name: bom_items_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bom_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bom_items_id_seq OWNER TO postgres;

--
-- Name: bom_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bom_items_id_seq OWNED BY public.bom_items.id;


--
-- Name: boms; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.boms (
    id integer NOT NULL,
    finished_product_id integer NOT NULL,
    output_quantity numeric(12,3) DEFAULT '1'::numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.boms OWNER TO postgres;

--
-- Name: boms_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.boms_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.boms_id_seq OWNER TO postgres;

--
-- Name: boms_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.boms_id_seq OWNED BY public.boms.id;


--
-- Name: capital_snapshots; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.capital_snapshots (
    id integer NOT NULL,
    snapshot_date date NOT NULL,
    inventory_value numeric(16,2) DEFAULT '0'::numeric NOT NULL,
    receivable numeric(16,2) DEFAULT '0'::numeric NOT NULL,
    cash_in_accounts numeric(16,2) DEFAULT '0'::numeric NOT NULL,
    payable numeric(16,2) DEFAULT '0'::numeric NOT NULL,
    capital numeric(16,2) DEFAULT '0'::numeric NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    expenses numeric(16,2) DEFAULT '0'::numeric NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.capital_snapshots OWNER TO postgres;

--
-- Name: capital_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.capital_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.capital_snapshots_id_seq OWNER TO postgres;

--
-- Name: capital_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.capital_snapshots_id_seq OWNED BY public.capital_snapshots.id;


--
-- Name: companies; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.companies (
    id integer NOT NULL,
    name text NOT NULL,
    owner_name text,
    mobile text,
    email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    logo text
);


ALTER TABLE public.companies OWNER TO postgres;

--
-- Name: companies_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.companies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.companies_id_seq OWNER TO postgres;

--
-- Name: companies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.companies_id_seq OWNED BY public.companies.id;


--
-- Name: customer_order_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customer_order_items (
    id integer NOT NULL,
    order_id integer NOT NULL,
    product_id integer NOT NULL,
    product_name text NOT NULL,
    unit text,
    qty numeric(12,3) NOT NULL,
    unit_price numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    line_total numeric(14,2) DEFAULT '0'::numeric NOT NULL,
    workload_card_id integer,
    company_id integer NOT NULL
);


ALTER TABLE public.customer_order_items OWNER TO postgres;

--
-- Name: customer_order_items_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.customer_order_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customer_order_items_id_seq OWNER TO postgres;

--
-- Name: customer_order_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.customer_order_items_id_seq OWNED BY public.customer_order_items.id;


--
-- Name: customer_orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customer_orders (
    id integer NOT NULL,
    order_no text,
    user_id integer,
    entity_id integer,
    customer_name text NOT NULL,
    customer_mobile text,
    status text DEFAULT 'pending'::text NOT NULL,
    total_items integer DEFAULT 0 NOT NULL,
    total_amount numeric(14,2) DEFAULT '0'::numeric NOT NULL,
    notes text,
    admin_remarks text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_draft boolean DEFAULT false NOT NULL,
    vehicle_number text,
    driver_name text,
    dispatch_date timestamp with time zone,
    dispatch_status text,
    company_id integer NOT NULL
);


ALTER TABLE public.customer_orders OWNER TO postgres;

--
-- Name: customer_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.customer_orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customer_orders_id_seq OWNER TO postgres;

--
-- Name: customer_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.customer_orders_id_seq OWNED BY public.customer_orders.id;


--
-- Name: entities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.entities (
    id integer NOT NULL,
    type text NOT NULL,
    name text NOT NULL,
    mobile text NOT NULL,
    gstin text,
    address text,
    city text,
    state text,
    pricing_tier text DEFAULT 'retail'::text,
    outstanding_balance numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    credit_limit numeric(12,2),
    user_id integer,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    district text,
    area text,
    pin_code text,
    gps_location text,
    company_id integer NOT NULL
);


ALTER TABLE public.entities OWNER TO postgres;

--
-- Name: entities_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.entities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.entities_id_seq OWNER TO postgres;

--
-- Name: entities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.entities_id_seq OWNED BY public.entities.id;


--
-- Name: expense_categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.expense_categories (
    id integer NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.expense_categories OWNER TO postgres;

--
-- Name: expense_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.expense_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.expense_categories_id_seq OWNER TO postgres;

--
-- Name: expense_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.expense_categories_id_seq OWNED BY public.expense_categories.id;


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.expenses (
    id integer NOT NULL,
    date date NOT NULL,
    category_id integer,
    category_name text NOT NULL,
    amount numeric(14,2) NOT NULL,
    payment_mode text NOT NULL,
    paid_to text,
    notes text,
    created_by_user_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.expenses OWNER TO postgres;

--
-- Name: expenses_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.expenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.expenses_id_seq OWNER TO postgres;

--
-- Name: expenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.expenses_id_seq OWNED BY public.expenses.id;


--
-- Name: invoice_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoice_items (
    id integer NOT NULL,
    invoice_id integer NOT NULL,
    product_id integer NOT NULL,
    product_name text NOT NULL,
    hsn_code text,
    qty numeric(12,3) NOT NULL,
    qty_boxes numeric(12,3),
    total_liters numeric(12,3),
    unit text NOT NULL,
    rate numeric(12,2) NOT NULL,
    mrp numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    discount_pct numeric(5,2) DEFAULT '0'::numeric NOT NULL,
    discount_amt numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    tax_pct numeric(5,2) DEFAULT '0'::numeric NOT NULL,
    cess_pct numeric(5,2) DEFAULT '0'::numeric NOT NULL,
    net_price numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    amount numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.invoice_items OWNER TO postgres;

--
-- Name: invoice_items_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.invoice_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.invoice_items_id_seq OWNER TO postgres;

--
-- Name: invoice_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.invoice_items_id_seq OWNED BY public.invoice_items.id;


--
-- Name: invoice_sequence; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoice_sequence (
    id integer NOT NULL,
    month integer NOT NULL,
    year integer NOT NULL,
    last_number integer DEFAULT 0 NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.invoice_sequence OWNER TO postgres;

--
-- Name: invoice_sequence_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.invoice_sequence_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.invoice_sequence_id_seq OWNER TO postgres;

--
-- Name: invoice_sequence_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.invoice_sequence_id_seq OWNED BY public.invoice_sequence.id;


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoices (
    id integer NOT NULL,
    invoice_no text NOT NULL,
    invoice_date timestamp with time zone DEFAULT now() NOT NULL,
    due_date timestamp with time zone,
    invoice_type text DEFAULT 'gst'::text NOT NULL,
    customer_id integer,
    customer_name text,
    customer_gstin text,
    billing_address text,
    shipping_address text,
    place_of_supply text DEFAULT 'Maharashtra'::text NOT NULL,
    salesman_id integer,
    salesman_name text,
    po_number text,
    e_way_bill_no text,
    subtotal numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    total_discount numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    total_tax numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    cgst numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    sgst numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    igst numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    freight numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    round_off numeric(6,2) DEFAULT '0'::numeric NOT NULL,
    grand_total numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    amount_paid numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    balance_due numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    status text DEFAULT 'saved'::text NOT NULL,
    created_by_user_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.invoices OWNER TO postgres;

--
-- Name: invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.invoices_id_seq OWNER TO postgres;

--
-- Name: invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.invoices_id_seq OWNED BY public.invoices.id;


--
-- Name: ledger_entries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ledger_entries (
    id integer NOT NULL,
    entity_id integer NOT NULL,
    date timestamp with time zone DEFAULT now() NOT NULL,
    description text NOT NULL,
    debit numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    credit numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    balance numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    type text NOT NULL,
    reference_id integer,
    reference_no text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    attachment_url text,
    created_by_id integer,
    created_by_name text,
    company_id integer NOT NULL
);


ALTER TABLE public.ledger_entries OWNER TO postgres;

--
-- Name: ledger_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ledger_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ledger_entries_id_seq OWNER TO postgres;

--
-- Name: ledger_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ledger_entries_id_seq OWNED BY public.ledger_entries.id;


--
-- Name: number_series; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.number_series (
    series_type text NOT NULL,
    prefix text DEFAULT ''::text NOT NULL,
    include_year boolean DEFAULT true NOT NULL,
    include_month boolean DEFAULT true NOT NULL,
    year_format text DEFAULT 'calendar'::text NOT NULL,
    separator text DEFAULT '/'::text NOT NULL,
    padding integer DEFAULT 0 NOT NULL,
    start_number integer DEFAULT 1 NOT NULL,
    next_number integer DEFAULT 1 NOT NULL,
    reset_rule text DEFAULT 'monthly'::text NOT NULL,
    period_key text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id integer NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.number_series OWNER TO postgres;

--
-- Name: number_series_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.number_series_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.number_series_id_seq OWNER TO postgres;

--
-- Name: number_series_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.number_series_id_seq OWNED BY public.number_series.id;


--
-- Name: payments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payments (
    id integer NOT NULL,
    receipt_id text NOT NULL,
    customer_id integer NOT NULL,
    customer_name text,
    salesman_id integer,
    salesman_name text,
    amount numeric(12,2) NOT NULL,
    mode text DEFAULT 'cash'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    notes text,
    approved_by_id integer,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id integer,
    collected_at timestamp with time zone,
    collected_by_id integer,
    company_id integer NOT NULL
);


ALTER TABLE public.payments OWNER TO postgres;

--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.payments_id_seq OWNER TO postgres;

--
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- Name: print_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.print_settings (
    id integer NOT NULL,
    company_id integer NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.print_settings OWNER TO postgres;

--
-- Name: print_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.print_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.print_settings_id_seq OWNER TO postgres;

--
-- Name: print_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.print_settings_id_seq OWNED BY public.print_settings.id;


--
-- Name: products; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.products (
    id integer NOT NULL,
    name text NOT NULL,
    print_name text,
    "group" text NOT NULL,
    brand text NOT NULL,
    item_code text NOT NULL,
    unit text DEFAULT 'QTY'::text NOT NULL,
    purchase_price numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    retail_price numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    wholesale_price numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    mrp numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    min_sale_price numeric(12,2),
    current_stock numeric(12,3) DEFAULT '0'::numeric NOT NULL,
    opening_stock numeric(12,3),
    opening_stock_value numeric(12,2),
    pricing_basis text DEFAULT 'manual'::text NOT NULL,
    wholesale_margin numeric(10,2),
    retail_margin numeric(10,2),
    hsn_code text,
    tax_rate numeric(5,2) DEFAULT '18'::numeric,
    liters_per_box numeric(10,3),
    not_for_sale boolean DEFAULT false NOT NULL,
    add_for_manufacturing boolean DEFAULT false NOT NULL,
    min_stock_threshold numeric(12,3),
    image_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    units_per_box numeric(10,3),
    commission_per_liter numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.products OWNER TO postgres;

--
-- Name: products_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.products_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.products_id_seq OWNER TO postgres;

--
-- Name: products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.products_id_seq OWNED BY public.products.id;


--
-- Name: purchase_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.purchase_items (
    id integer NOT NULL,
    purchase_id integer NOT NULL,
    product_id integer NOT NULL,
    product_name text NOT NULL,
    hsn_code text,
    qty numeric(12,3) NOT NULL,
    unit text NOT NULL,
    rate numeric(12,2) NOT NULL,
    discount_pct numeric(5,2) DEFAULT '0'::numeric NOT NULL,
    discount_amt numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    tax_pct numeric(5,2) DEFAULT '0'::numeric NOT NULL,
    amount numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.purchase_items OWNER TO postgres;

--
-- Name: purchase_items_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.purchase_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.purchase_items_id_seq OWNER TO postgres;

--
-- Name: purchase_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.purchase_items_id_seq OWNED BY public.purchase_items.id;


--
-- Name: purchase_sequence; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.purchase_sequence (
    id integer NOT NULL,
    month integer NOT NULL,
    year integer NOT NULL,
    last_number integer DEFAULT 0 NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.purchase_sequence OWNER TO postgres;

--
-- Name: purchase_sequence_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.purchase_sequence_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.purchase_sequence_id_seq OWNER TO postgres;

--
-- Name: purchase_sequence_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.purchase_sequence_id_seq OWNED BY public.purchase_sequence.id;


--
-- Name: purchases; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.purchases (
    id integer NOT NULL,
    bill_no text NOT NULL,
    vendor_bill_no text,
    bill_date timestamp with time zone DEFAULT now() NOT NULL,
    due_date timestamp with time zone,
    bill_type text DEFAULT 'gst'::text NOT NULL,
    vendor_id integer,
    vendor_name text,
    vendor_gstin text,
    place_of_supply text DEFAULT 'Maharashtra'::text NOT NULL,
    notes text,
    subtotal numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    total_discount numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    total_tax numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    cgst numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    sgst numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    igst numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    freight numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    round_off numeric(6,2) DEFAULT '0'::numeric NOT NULL,
    grand_total numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    amount_paid numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    balance_due numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    status text DEFAULT 'saved'::text NOT NULL,
    created_by_user_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.purchases OWNER TO postgres;

--
-- Name: purchases_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.purchases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.purchases_id_seq OWNER TO postgres;

--
-- Name: purchases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.purchases_id_seq OWNED BY public.purchases.id;


--
-- Name: reward_progress; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reward_progress (
    id integer NOT NULL,
    scheme_id integer NOT NULL,
    customer_id integer NOT NULL,
    liters_achieved numeric(12,3) DEFAULT '0'::numeric NOT NULL,
    is_reward_achieved boolean DEFAULT false NOT NULL,
    is_disbursed boolean DEFAULT false NOT NULL,
    disbursed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.reward_progress OWNER TO postgres;

--
-- Name: reward_progress_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.reward_progress_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.reward_progress_id_seq OWNER TO postgres;

--
-- Name: reward_progress_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.reward_progress_id_seq OWNED BY public.reward_progress.id;


--
-- Name: reward_schemes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reward_schemes (
    id integer NOT NULL,
    product_id integer NOT NULL,
    target_liters numeric(12,3) NOT NULL,
    reward_type text NOT NULL,
    reward_value text NOT NULL,
    start_date timestamp with time zone NOT NULL,
    end_date timestamp with time zone NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    scheme_name text DEFAULT ''::text NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.reward_schemes OWNER TO postgres;

--
-- Name: reward_schemes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.reward_schemes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.reward_schemes_id_seq OWNER TO postgres;

--
-- Name: reward_schemes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.reward_schemes_id_seq OWNED BY public.reward_schemes.id;


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.role_permissions (
    id integer NOT NULL,
    role text NOT NULL,
    feature text NOT NULL,
    allowed boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.role_permissions OWNER TO postgres;

--
-- Name: role_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.role_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.role_permissions_id_seq OWNER TO postgres;

--
-- Name: role_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.role_permissions_id_seq OWNED BY public.role_permissions.id;


--
-- Name: stock_movements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stock_movements (
    id integer NOT NULL,
    product_id integer NOT NULL,
    type text NOT NULL,
    quantity numeric(12,3) NOT NULL,
    reason text NOT NULL,
    reference_id integer,
    reference_type text,
    user_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.stock_movements OWNER TO postgres;

--
-- Name: stock_movements_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.stock_movements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stock_movements_id_seq OWNER TO postgres;

--
-- Name: stock_movements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.stock_movements_id_seq OWNED BY public.stock_movements.id;


--
-- Name: subscription_alerts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subscription_alerts (
    id integer NOT NULL,
    company_id integer NOT NULL,
    subscription_id integer NOT NULL,
    alert_type text NOT NULL,
    message text NOT NULL,
    days_remaining integer DEFAULT 0 NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.subscription_alerts OWNER TO postgres;

--
-- Name: subscription_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.subscription_alerts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.subscription_alerts_id_seq OWNER TO postgres;

--
-- Name: subscription_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.subscription_alerts_id_seq OWNED BY public.subscription_alerts.id;


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subscriptions (
    id integer NOT NULL,
    company_id integer NOT NULL,
    plan_name text NOT NULL,
    subscription_start_date timestamp with time zone NOT NULL,
    subscription_end_date timestamp with time zone NOT NULL,
    subscription_amount numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    payment_status text DEFAULT 'pending'::text NOT NULL,
    subscription_status text DEFAULT 'active'::text NOT NULL,
    last_payment_date timestamp with time zone,
    next_due_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.subscriptions OWNER TO postgres;

--
-- Name: subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.subscriptions_id_seq OWNER TO postgres;

--
-- Name: subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.subscriptions_id_seq OWNED BY public.subscriptions.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username text NOT NULL,
    password_hash text NOT NULL,
    role text DEFAULT 'salesman'::text NOT NULL,
    name text NOT NULL,
    entity_id integer,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id integer
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: worker_attendance; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.worker_attendance (
    id integer NOT NULL,
    worker_id integer NOT NULL,
    date date NOT NULL,
    status text NOT NULL,
    wage_amount numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.worker_attendance OWNER TO postgres;

--
-- Name: worker_attendance_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.worker_attendance_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.worker_attendance_id_seq OWNER TO postgres;

--
-- Name: worker_attendance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.worker_attendance_id_seq OWNED BY public.worker_attendance.id;


--
-- Name: worker_payments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.worker_payments (
    id integer NOT NULL,
    worker_id integer NOT NULL,
    amount numeric(12,2) NOT NULL,
    paid_on date NOT NULL,
    payment_mode text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.worker_payments OWNER TO postgres;

--
-- Name: worker_payments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.worker_payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.worker_payments_id_seq OWNER TO postgres;

--
-- Name: worker_payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.worker_payments_id_seq OWNED BY public.worker_payments.id;


--
-- Name: workers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.workers (
    id integer NOT NULL,
    name text NOT NULL,
    phone text,
    skill text,
    daily_wage numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    joined_at date,
    is_active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.workers OWNER TO postgres;

--
-- Name: workers_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.workers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.workers_id_seq OWNER TO postgres;

--
-- Name: workers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.workers_id_seq OWNED BY public.workers.id;


--
-- Name: workload_cards; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.workload_cards (
    id integer NOT NULL,
    product_id integer NOT NULL,
    target_qty numeric(12,3) NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    worker_id integer,
    worker_name text,
    order_type text DEFAULT 'manual_order'::text NOT NULL,
    reference_order_id integer,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id integer NOT NULL
);


ALTER TABLE public.workload_cards OWNER TO postgres;

--
-- Name: workload_cards_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.workload_cards_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.workload_cards_id_seq OWNER TO postgres;

--
-- Name: workload_cards_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.workload_cards_id_seq OWNED BY public.workload_cards.id;


--
-- Name: account_transactions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.account_transactions ALTER COLUMN id SET DEFAULT nextval('public.account_transactions_id_seq'::regclass);


--
-- Name: accounts id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.accounts ALTER COLUMN id SET DEFAULT nextval('public.accounts_id_seq'::regclass);


--
-- Name: app_settings id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_settings ALTER COLUMN id SET DEFAULT nextval('public.app_settings_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: bom_items id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bom_items ALTER COLUMN id SET DEFAULT nextval('public.bom_items_id_seq'::regclass);


--
-- Name: boms id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.boms ALTER COLUMN id SET DEFAULT nextval('public.boms_id_seq'::regclass);


--
-- Name: capital_snapshots id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.capital_snapshots ALTER COLUMN id SET DEFAULT nextval('public.capital_snapshots_id_seq'::regclass);


--
-- Name: companies id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.companies ALTER COLUMN id SET DEFAULT nextval('public.companies_id_seq'::regclass);


--
-- Name: customer_order_items id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_order_items ALTER COLUMN id SET DEFAULT nextval('public.customer_order_items_id_seq'::regclass);


--
-- Name: customer_orders id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_orders ALTER COLUMN id SET DEFAULT nextval('public.customer_orders_id_seq'::regclass);


--
-- Name: entities id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entities ALTER COLUMN id SET DEFAULT nextval('public.entities_id_seq'::regclass);


--
-- Name: expense_categories id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expense_categories ALTER COLUMN id SET DEFAULT nextval('public.expense_categories_id_seq'::regclass);


--
-- Name: expenses id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expenses ALTER COLUMN id SET DEFAULT nextval('public.expenses_id_seq'::regclass);


--
-- Name: invoice_items id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_items ALTER COLUMN id SET DEFAULT nextval('public.invoice_items_id_seq'::regclass);


--
-- Name: invoice_sequence id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_sequence ALTER COLUMN id SET DEFAULT nextval('public.invoice_sequence_id_seq'::regclass);


--
-- Name: invoices id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices ALTER COLUMN id SET DEFAULT nextval('public.invoices_id_seq'::regclass);


--
-- Name: ledger_entries id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ledger_entries ALTER COLUMN id SET DEFAULT nextval('public.ledger_entries_id_seq'::regclass);


--
-- Name: number_series id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.number_series ALTER COLUMN id SET DEFAULT nextval('public.number_series_id_seq'::regclass);


--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- Name: print_settings id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.print_settings ALTER COLUMN id SET DEFAULT nextval('public.print_settings_id_seq'::regclass);


--
-- Name: products id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products ALTER COLUMN id SET DEFAULT nextval('public.products_id_seq'::regclass);


--
-- Name: purchase_items id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_items ALTER COLUMN id SET DEFAULT nextval('public.purchase_items_id_seq'::regclass);


--
-- Name: purchase_sequence id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_sequence ALTER COLUMN id SET DEFAULT nextval('public.purchase_sequence_id_seq'::regclass);


--
-- Name: purchases id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchases ALTER COLUMN id SET DEFAULT nextval('public.purchases_id_seq'::regclass);


--
-- Name: reward_progress id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reward_progress ALTER COLUMN id SET DEFAULT nextval('public.reward_progress_id_seq'::regclass);


--
-- Name: reward_schemes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reward_schemes ALTER COLUMN id SET DEFAULT nextval('public.reward_schemes_id_seq'::regclass);


--
-- Name: role_permissions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions ALTER COLUMN id SET DEFAULT nextval('public.role_permissions_id_seq'::regclass);


--
-- Name: stock_movements id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_movements ALTER COLUMN id SET DEFAULT nextval('public.stock_movements_id_seq'::regclass);


--
-- Name: subscription_alerts id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscription_alerts ALTER COLUMN id SET DEFAULT nextval('public.subscription_alerts_id_seq'::regclass);


--
-- Name: subscriptions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions ALTER COLUMN id SET DEFAULT nextval('public.subscriptions_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: worker_attendance id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.worker_attendance ALTER COLUMN id SET DEFAULT nextval('public.worker_attendance_id_seq'::regclass);


--
-- Name: worker_payments id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.worker_payments ALTER COLUMN id SET DEFAULT nextval('public.worker_payments_id_seq'::regclass);


--
-- Name: workers id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workers ALTER COLUMN id SET DEFAULT nextval('public.workers_id_seq'::regclass);


--
-- Name: workload_cards id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workload_cards ALTER COLUMN id SET DEFAULT nextval('public.workload_cards_id_seq'::regclass);


--
-- Name: account_transactions account_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.account_transactions
    ADD CONSTRAINT account_transactions_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: account_transactions acct_txn_company_receipt_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.account_transactions
    ADD CONSTRAINT acct_txn_company_receipt_unique UNIQUE (company_id, receipt_no);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: bom_items bom_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bom_items
    ADD CONSTRAINT bom_items_pkey PRIMARY KEY (id);


--
-- Name: boms boms_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.boms
    ADD CONSTRAINT boms_pkey PRIMARY KEY (id);


--
-- Name: capital_snapshots capital_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.capital_snapshots
    ADD CONSTRAINT capital_snapshots_pkey PRIMARY KEY (id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: customer_order_items customer_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_order_items
    ADD CONSTRAINT customer_order_items_pkey PRIMARY KEY (id);


--
-- Name: customer_orders customer_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_orders
    ADD CONSTRAINT customer_orders_pkey PRIMARY KEY (id);


--
-- Name: entities entities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_pkey PRIMARY KEY (id);


--
-- Name: expense_categories expense_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: invoice_items invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);


--
-- Name: invoice_sequence invoice_sequence_company_month_year_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_sequence
    ADD CONSTRAINT invoice_sequence_company_month_year_unique UNIQUE (company_id, month, year);


--
-- Name: invoice_sequence invoice_sequence_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_sequence
    ADD CONSTRAINT invoice_sequence_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_company_invoice_no_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_company_invoice_no_unique UNIQUE (company_id, invoice_no);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: ledger_entries ledger_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_pkey PRIMARY KEY (id);


--
-- Name: number_series number_series_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.number_series
    ADD CONSTRAINT number_series_pkey PRIMARY KEY (id);


--
-- Name: payments payments_company_receipt_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_company_receipt_unique UNIQUE (company_id, receipt_id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: print_settings print_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.print_settings
    ADD CONSTRAINT print_settings_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: purchase_items purchase_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_pkey PRIMARY KEY (id);


--
-- Name: purchase_sequence purchase_sequence_company_month_year_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_sequence
    ADD CONSTRAINT purchase_sequence_company_month_year_unique UNIQUE (company_id, month, year);


--
-- Name: purchase_sequence purchase_sequence_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_sequence
    ADD CONSTRAINT purchase_sequence_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_company_bill_no_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_company_bill_no_unique UNIQUE (company_id, bill_no);


--
-- Name: purchases purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);


--
-- Name: reward_progress reward_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reward_progress
    ADD CONSTRAINT reward_progress_pkey PRIMARY KEY (id);


--
-- Name: reward_schemes reward_schemes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reward_schemes
    ADD CONSTRAINT reward_schemes_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);


--
-- Name: stock_movements stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);


--
-- Name: subscription_alerts subscription_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscription_alerts
    ADD CONSTRAINT subscription_alerts_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_unique UNIQUE (username);


--
-- Name: worker_attendance worker_attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.worker_attendance
    ADD CONSTRAINT worker_attendance_pkey PRIMARY KEY (id);


--
-- Name: worker_payments worker_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.worker_payments
    ADD CONSTRAINT worker_payments_pkey PRIMARY KEY (id);


--
-- Name: workers workers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workers
    ADD CONSTRAINT workers_pkey PRIMARY KEY (id);


--
-- Name: workload_cards workload_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workload_cards
    ADD CONSTRAINT workload_cards_pkey PRIMARY KEY (id);


--
-- Name: accounts_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX accounts_company_idx ON public.accounts USING btree (company_id);


--
-- Name: accounts_type_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX accounts_type_idx ON public.accounts USING btree (type);


--
-- Name: acct_txn_account_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX acct_txn_account_idx ON public.account_transactions USING btree (account_id);


--
-- Name: acct_txn_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX acct_txn_company_idx ON public.account_transactions USING btree (company_id);


--
-- Name: acct_txn_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX acct_txn_created_idx ON public.account_transactions USING btree (created_at);


--
-- Name: acct_txn_direction_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX acct_txn_direction_idx ON public.account_transactions USING btree (direction);


--
-- Name: app_settings_company_key_uq; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX app_settings_company_key_uq ON public.app_settings USING btree (company_id, key);


--
-- Name: audit_log_action_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX audit_log_action_idx ON public.audit_log USING btree (action);


--
-- Name: audit_log_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX audit_log_company_idx ON public.audit_log USING btree (company_id);


--
-- Name: audit_log_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX audit_log_user_idx ON public.audit_log USING btree (user_id);


--
-- Name: bom_items_bom_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX bom_items_bom_idx ON public.bom_items USING btree (bom_id);


--
-- Name: bom_items_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX bom_items_company_idx ON public.bom_items USING btree (company_id);


--
-- Name: boms_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX boms_company_idx ON public.boms USING btree (company_id);


--
-- Name: capital_snapshots_company_date_uq; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX capital_snapshots_company_date_uq ON public.capital_snapshots USING btree (company_id, snapshot_date);


--
-- Name: customer_order_items_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX customer_order_items_company_idx ON public.customer_order_items USING btree (company_id);


--
-- Name: customer_order_items_order_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX customer_order_items_order_idx ON public.customer_order_items USING btree (order_id);


--
-- Name: customer_orders_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX customer_orders_company_idx ON public.customer_orders USING btree (company_id);


--
-- Name: customer_orders_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX customer_orders_status_idx ON public.customer_orders USING btree (status);


--
-- Name: customer_orders_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX customer_orders_user_idx ON public.customer_orders USING btree (user_id);


--
-- Name: entities_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX entities_company_idx ON public.entities USING btree (company_id);


--
-- Name: entities_mobile_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX entities_mobile_idx ON public.entities USING btree (mobile);


--
-- Name: entities_type_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX entities_type_idx ON public.entities USING btree (type);


--
-- Name: expense_categories_company_name_uq; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX expense_categories_company_name_uq ON public.expense_categories USING btree (company_id, name);


--
-- Name: expenses_category_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX expenses_category_idx ON public.expenses USING btree (category_id);


--
-- Name: expenses_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX expenses_company_idx ON public.expenses USING btree (company_id);


--
-- Name: expenses_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX expenses_date_idx ON public.expenses USING btree (date);


--
-- Name: invoice_items_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoice_items_company_idx ON public.invoice_items USING btree (company_id);


--
-- Name: invoice_items_invoice_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoice_items_invoice_idx ON public.invoice_items USING btree (invoice_id);


--
-- Name: invoices_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoices_company_idx ON public.invoices USING btree (company_id);


--
-- Name: invoices_customer_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoices_customer_idx ON public.invoices USING btree (customer_id);


--
-- Name: invoices_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoices_date_idx ON public.invoices USING btree (invoice_date);


--
-- Name: invoices_salesman_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoices_salesman_idx ON public.invoices USING btree (salesman_id);


--
-- Name: ledger_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ledger_company_idx ON public.ledger_entries USING btree (company_id);


--
-- Name: ledger_entity_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ledger_entity_idx ON public.ledger_entries USING btree (entity_id);


--
-- Name: number_series_company_type_uq; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX number_series_company_type_uq ON public.number_series USING btree (company_id, series_type);


--
-- Name: payments_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX payments_company_idx ON public.payments USING btree (company_id);


--
-- Name: payments_customer_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX payments_customer_idx ON public.payments USING btree (customer_id);


--
-- Name: payments_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX payments_status_idx ON public.payments USING btree (status);


--
-- Name: print_settings_company_uq; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX print_settings_company_uq ON public.print_settings USING btree (company_id);


--
-- Name: products_brand_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX products_brand_idx ON public.products USING btree (brand);


--
-- Name: products_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX products_company_idx ON public.products USING btree (company_id);


--
-- Name: products_company_item_code_uq; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX products_company_item_code_uq ON public.products USING btree (company_id, item_code);


--
-- Name: products_deleted_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX products_deleted_at_idx ON public.products USING btree (deleted_at);


--
-- Name: products_group_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX products_group_idx ON public.products USING btree ("group");


--
-- Name: purchase_items_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX purchase_items_company_idx ON public.purchase_items USING btree (company_id);


--
-- Name: purchase_items_purchase_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX purchase_items_purchase_idx ON public.purchase_items USING btree (purchase_id);


--
-- Name: purchases_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX purchases_company_idx ON public.purchases USING btree (company_id);


--
-- Name: purchases_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX purchases_date_idx ON public.purchases USING btree (bill_date);


--
-- Name: purchases_vendor_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX purchases_vendor_idx ON public.purchases USING btree (vendor_id);


--
-- Name: reward_progress_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX reward_progress_company_idx ON public.reward_progress USING btree (company_id);


--
-- Name: reward_progress_scheme_customer_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX reward_progress_scheme_customer_idx ON public.reward_progress USING btree (scheme_id, customer_id);


--
-- Name: reward_schemes_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX reward_schemes_company_idx ON public.reward_schemes USING btree (company_id);


--
-- Name: role_permissions_company_role_feature_uq; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX role_permissions_company_role_feature_uq ON public.role_permissions USING btree (company_id, role, feature);


--
-- Name: stock_movements_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX stock_movements_company_idx ON public.stock_movements USING btree (company_id);


--
-- Name: stock_movements_product_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX stock_movements_product_idx ON public.stock_movements USING btree (product_id);


--
-- Name: subscription_alert_sub_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX subscription_alert_sub_idx ON public.subscription_alerts USING btree (subscription_id);


--
-- Name: subscription_alert_type_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX subscription_alert_type_unique ON public.subscription_alerts USING btree (subscription_id, alert_type);


--
-- Name: subscription_company_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX subscription_company_unique ON public.subscriptions USING btree (company_id);


--
-- Name: users_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX users_company_idx ON public.users USING btree (company_id);


--
-- Name: worker_attendance_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX worker_attendance_company_idx ON public.worker_attendance USING btree (company_id);


--
-- Name: worker_attendance_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX worker_attendance_date_idx ON public.worker_attendance USING btree (date);


--
-- Name: worker_attendance_worker_date_uq; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX worker_attendance_worker_date_uq ON public.worker_attendance USING btree (worker_id, date);


--
-- Name: worker_payments_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX worker_payments_company_idx ON public.worker_payments USING btree (company_id);


--
-- Name: worker_payments_paid_on_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX worker_payments_paid_on_idx ON public.worker_payments USING btree (paid_on);


--
-- Name: worker_payments_worker_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX worker_payments_worker_idx ON public.worker_payments USING btree (worker_id);


--
-- Name: workers_active_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX workers_active_idx ON public.workers USING btree (is_active);


--
-- Name: workers_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX workers_company_idx ON public.workers USING btree (company_id);


--
-- Name: workload_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX workload_company_idx ON public.workload_cards USING btree (company_id);


--
-- Name: workload_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX workload_status_idx ON public.workload_cards USING btree (status);


--
-- Name: account_transactions account_transactions_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.account_transactions
    ADD CONSTRAINT account_transactions_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: bom_items bom_items_bom_id_boms_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bom_items
    ADD CONSTRAINT bom_items_bom_id_boms_id_fk FOREIGN KEY (bom_id) REFERENCES public.boms(id) ON DELETE CASCADE;


--
-- Name: bom_items bom_items_material_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bom_items
    ADD CONSTRAINT bom_items_material_product_id_products_id_fk FOREIGN KEY (material_product_id) REFERENCES public.products(id);


--
-- Name: boms boms_finished_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.boms
    ADD CONSTRAINT boms_finished_product_id_products_id_fk FOREIGN KEY (finished_product_id) REFERENCES public.products(id);


--
-- Name: customer_order_items customer_order_items_order_id_customer_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_order_items
    ADD CONSTRAINT customer_order_items_order_id_customer_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.customer_orders(id) ON DELETE CASCADE;


--
-- Name: expenses expenses_category_id_expense_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_category_id_expense_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.expense_categories(id) ON DELETE SET NULL;


--
-- Name: invoice_items invoice_items_invoice_id_invoices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_invoice_id_invoices_id_fk FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_items invoice_items_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: invoices invoices_customer_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_customer_id_entities_id_fk FOREIGN KEY (customer_id) REFERENCES public.entities(id);


--
-- Name: ledger_entries ledger_entries_entity_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_entity_id_entities_id_fk FOREIGN KEY (entity_id) REFERENCES public.entities(id);


--
-- Name: payments payments_customer_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_customer_id_entities_id_fk FOREIGN KEY (customer_id) REFERENCES public.entities(id);


--
-- Name: purchase_items purchase_items_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: purchase_items purchase_items_purchase_id_purchases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_purchase_id_purchases_id_fk FOREIGN KEY (purchase_id) REFERENCES public.purchases(id) ON DELETE CASCADE;


--
-- Name: purchases purchases_vendor_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_vendor_id_entities_id_fk FOREIGN KEY (vendor_id) REFERENCES public.entities(id);


--
-- Name: reward_progress reward_progress_customer_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reward_progress
    ADD CONSTRAINT reward_progress_customer_id_entities_id_fk FOREIGN KEY (customer_id) REFERENCES public.entities(id);


--
-- Name: reward_progress reward_progress_scheme_id_reward_schemes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reward_progress
    ADD CONSTRAINT reward_progress_scheme_id_reward_schemes_id_fk FOREIGN KEY (scheme_id) REFERENCES public.reward_schemes(id);


--
-- Name: reward_schemes reward_schemes_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reward_schemes
    ADD CONSTRAINT reward_schemes_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: stock_movements stock_movements_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: worker_attendance worker_attendance_worker_id_workers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.worker_attendance
    ADD CONSTRAINT worker_attendance_worker_id_workers_id_fk FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE CASCADE;


--
-- Name: worker_payments worker_payments_worker_id_workers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.worker_payments
    ADD CONSTRAINT worker_payments_worker_id_workers_id_fk FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE CASCADE;


--
-- Name: workload_cards workload_cards_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workload_cards
    ADD CONSTRAINT workload_cards_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- PostgreSQL database dump complete
--

\unrestrict Bj3OfosX12qBer5YTf1v0vlzSz5g5fP926wRz1OKKr5jUhXX6KMZ4lT0p0FU0nS



--
-- Name: backup_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.backup_settings (
    id integer NOT NULL,
    company_id integer NOT NULL,
    daily_enabled boolean DEFAULT false NOT NULL,
    weekly_enabled boolean DEFAULT false NOT NULL,
    monthly_enabled boolean DEFAULT false NOT NULL,
    last_daily_at timestamp with time zone,
    last_weekly_at timestamp with time zone,
    last_monthly_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.backup_settings OWNER TO postgres;

CREATE SEQUENCE public.backup_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.backup_settings_id_seq OWNER TO postgres;
ALTER SEQUENCE public.backup_settings_id_seq OWNED BY public.backup_settings.id;
ALTER TABLE ONLY public.backup_settings ALTER COLUMN id SET DEFAULT nextval('public.backup_settings_id_seq'::regclass);
ALTER TABLE ONLY public.backup_settings
    ADD CONSTRAINT backup_settings_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX backup_settings_company_uq ON public.backup_settings USING btree (company_id);


--
-- Name: backups; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.backups (
    id integer NOT NULL,
    company_id integer NOT NULL,
    file_name text NOT NULL,
    storage_key text,
    size_bytes integer DEFAULT 0 NOT NULL,
    type text NOT NULL,
    table_counts jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by integer NOT NULL,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.backups OWNER TO postgres;

CREATE SEQUENCE public.backups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.backups_id_seq OWNER TO postgres;
ALTER SEQUENCE public.backups_id_seq OWNED BY public.backups.id;
ALTER TABLE ONLY public.backups ALTER COLUMN id SET DEFAULT nextval('public.backups_id_seq'::regclass);
ALTER TABLE ONLY public.backups
    ADD CONSTRAINT backups_pkey PRIMARY KEY (id);
CREATE INDEX backups_company_idx ON public.backups USING btree (company_id);
CREATE INDEX backups_created_at_idx ON public.backups USING btree (created_at);
