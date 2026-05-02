-- ===== Profiles =====
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are viewable by authenticated users"
  ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', ''), NEW.email);
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.profiles (id, name, email)
SELECT u.id, COALESCE(u.raw_user_meta_data->>'name', ''), u.email
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

-- ===== Messages =====
CREATE TYPE public.message_sender AS ENUM ('buyer', 'seller');

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id integer NOT NULL,
  seller_name text NOT NULL,
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender public.message_sender NOT NULL,
  body text NOT NULL CHECK (char_length(body) > 0 AND char_length(body) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_thread ON public.messages (buyer_id, product_id, created_at);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Buyers can read their own messages"
  ON public.messages FOR SELECT TO authenticated USING (auth.uid() = buyer_id);

CREATE POLICY "Buyers can insert messages in their own thread"
  ON public.messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = buyer_id);

-- ===== Notifications =====
CREATE TABLE public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  type TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_created ON public.notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread ON public.notifications (user_id) WHERE read = false;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications"
  ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own notifications"
  ON public.notifications FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own notifications"
  ON public.notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own notifications"
  ON public.notifications FOR DELETE TO authenticated USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

CREATE OR REPLACE FUNCTION public.notify_on_seller_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.sender = 'seller' THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      NEW.buyer_id, 'message',
      'New reply from ' || NEW.seller_name,
      LEFT(NEW.body, 140),
      '/messages/' || NEW.product_id
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_on_seller_message() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_notify_on_seller_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_seller_message();

-- ===== Orders =====
CREATE TABLE public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  seller_id UUID,
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  commission_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  seller_earnings NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_user ON public.orders (user_id, created_at DESC);
CREATE INDEX idx_orders_seller ON public.orders (seller_id, created_at DESC);
CREATE INDEX idx_orders_payment_status ON public.orders (payment_status);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own orders"
  ON public.orders FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own orders"
  ON public.orders FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own orders"
  ON public.orders FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Sellers can view orders for their items"
  ON public.orders FOR SELECT TO authenticated USING (auth.uid() = seller_id);

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Validation trigger for payment_status
CREATE OR REPLACE FUNCTION public.validate_order_payment_status()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.payment_status NOT IN ('pending', 'paid', 'failed') THEN
    RAISE EXCEPTION 'Invalid payment_status: %. Allowed: pending, paid, failed', NEW.payment_status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_order_payment_status_trigger
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.validate_order_payment_status();

-- ===== Sellers =====
CREATE TABLE public.sellers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  display_name TEXT,
  total_sales NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_commission_paid NUMERIC(14, 2) NOT NULL DEFAULT 0,
  net_earnings NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.sellers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sellers are viewable by authenticated users"
  ON public.sellers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert their own seller profile"
  ON public.sellers FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own seller profile"
  ON public.sellers FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER sellers_set_updated_at
  BEFORE UPDATE ON public.sellers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== Order commission calc =====
CREATE OR REPLACE FUNCTION public.calculate_order_commission()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  commission_rate CONSTANT NUMERIC := 0.05;
  total NUMERIC;
BEGIN
  total := COALESCE(NEW.total_amount, 0);
  IF NEW.status = 'completed' THEN
    NEW.commission_amount := ROUND(total * commission_rate, 2);
    NEW.seller_earnings  := ROUND(total - NEW.commission_amount, 2);
  ELSE
    NEW.commission_amount := 0;
    NEW.seller_earnings  := 0;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.calculate_order_commission() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER orders_calculate_commission
  BEFORE INSERT OR UPDATE OF total_amount, status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.calculate_order_commission();

CREATE OR REPLACE FUNCTION public.apply_seller_totals_on_completion()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  was_completed BOOLEAN := (TG_OP = 'UPDATE' AND OLD.status = 'completed');
  is_completed  BOOLEAN := (NEW.status = 'completed');
  target_seller UUID := NEW.seller_id;
BEGIN
  IF target_seller IS NULL THEN
    RETURN NEW;
  END IF;

  IF is_completed AND NOT was_completed THEN
    INSERT INTO public.sellers (user_id, total_sales, total_commission_paid, net_earnings)
    VALUES (target_seller, NEW.total_amount, NEW.commission_amount, NEW.seller_earnings)
    ON CONFLICT (user_id) DO UPDATE
      SET total_sales           = public.sellers.total_sales           + EXCLUDED.total_sales,
          total_commission_paid = public.sellers.total_commission_paid + EXCLUDED.total_commission_paid,
          net_earnings          = public.sellers.net_earnings          + EXCLUDED.net_earnings;
  ELSIF was_completed AND NOT is_completed THEN
    UPDATE public.sellers
    SET total_sales           = total_sales           - OLD.total_amount,
        total_commission_paid = total_commission_paid - OLD.commission_amount,
        net_earnings          = net_earnings          - OLD.seller_earnings
    WHERE user_id = OLD.seller_id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_seller_totals_on_completion() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER orders_apply_seller_totals
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.apply_seller_totals_on_completion();

-- ===== Roles =====
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated;

CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert roles"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete roles"
  ON public.user_roles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ===== Admin revenue stats =====
CREATE OR REPLACE FUNCTION public.get_admin_revenue_stats()
RETURNS TABLE (total_commission NUMERIC, total_orders BIGINT, total_sellers BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT
    COALESCE((SELECT SUM(commission_amount) FROM public.orders WHERE status = 'completed'), 0)::NUMERIC,
    (SELECT COUNT(*) FROM public.orders)::BIGINT,
    (SELECT COUNT(*) FROM public.sellers)::BIGINT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_revenue_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_revenue_stats() TO authenticated;

-- ===== Product analytics =====
CREATE TABLE public.product_views (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id INTEGER NOT NULL,
  viewer_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_views_product_id ON public.product_views(product_id);
CREATE INDEX idx_product_views_created_at ON public.product_views(created_at DESC);

ALTER TABLE public.product_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can record a product view"
  ON public.product_views FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Admins can view all product views"
  ON public.product_views FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.product_purchases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  buyer_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_purchases_product_id ON public.product_purchases(product_id);
CREATE INDEX idx_product_purchases_created_at ON public.product_purchases(created_at DESC);

ALTER TABLE public.product_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can record a purchase"
  ON public.product_purchases FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Admins can view all product purchases"
  ON public.product_purchases FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.get_top_viewed_products(_limit INTEGER DEFAULT 10)
RETURNS TABLE(product_id INTEGER, view_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT pv.product_id, COUNT(*)::BIGINT AS view_count
    FROM public.product_views pv
    GROUP BY pv.product_id
    ORDER BY view_count DESC
    LIMIT _limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_top_selling_products(_limit INTEGER DEFAULT 10)
RETURNS TABLE(product_id INTEGER, units_sold BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT pp.product_id, SUM(pp.qty)::BIGINT AS units_sold
    FROM public.product_purchases pp
    GROUP BY pp.product_id
    ORDER BY units_sold DESC
    LIMIT _limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_top_viewed_products(INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_top_selling_products(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_top_viewed_products(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_selling_products(INTEGER) TO authenticated;