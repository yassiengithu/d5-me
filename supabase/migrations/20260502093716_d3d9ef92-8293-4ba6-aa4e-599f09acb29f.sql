-- Singleton platform earnings table
CREATE TABLE IF NOT EXISTS public.platform_earnings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  total_commission_earned NUMERIC NOT NULL DEFAULT 0,
  available_balance NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_earnings_singleton CHECK (id = TRUE)
);

INSERT INTO public.platform_earnings (id) VALUES (TRUE)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_earnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view platform earnings"
  ON public.platform_earnings
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Update completion trigger to also credit platform earnings
CREATE OR REPLACE FUNCTION public.apply_seller_totals_on_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  was_completed BOOLEAN := (TG_OP = 'UPDATE' AND OLD.status = 'completed');
  is_completed  BOOLEAN := (NEW.status = 'completed');
  target_seller UUID := NEW.seller_id;
BEGIN
  IF target_seller IS NULL THEN
    RETURN NEW;
  END IF;

  IF is_completed AND NOT was_completed THEN
    INSERT INTO public.sellers (
      user_id, total_sales, total_commission_paid, net_earnings,
      wallet_balance, total_earnings
    )
    VALUES (
      target_seller, NEW.total_amount, NEW.commission_amount, NEW.seller_earnings,
      NEW.seller_earnings, NEW.seller_earnings
    )
    ON CONFLICT (user_id) DO UPDATE
      SET total_sales           = public.sellers.total_sales           + EXCLUDED.total_sales,
          total_commission_paid = public.sellers.total_commission_paid + EXCLUDED.total_commission_paid,
          net_earnings          = public.sellers.net_earnings          + EXCLUDED.net_earnings,
          wallet_balance        = public.sellers.wallet_balance        + EXCLUDED.wallet_balance,
          total_earnings        = public.sellers.total_earnings        + EXCLUDED.total_earnings;

    UPDATE public.platform_earnings
    SET total_commission_earned = total_commission_earned + NEW.commission_amount,
        available_balance       = available_balance       + NEW.commission_amount,
        updated_at              = now()
    WHERE id = TRUE;
  ELSIF was_completed AND NOT is_completed THEN
    UPDATE public.sellers
    SET total_sales           = total_sales           - OLD.total_amount,
        total_commission_paid = total_commission_paid - OLD.commission_amount,
        net_earnings          = net_earnings          - OLD.seller_earnings,
        wallet_balance        = wallet_balance        - OLD.seller_earnings,
        total_earnings        = total_earnings        - OLD.seller_earnings
    WHERE user_id = OLD.seller_id;

    UPDATE public.platform_earnings
    SET total_commission_earned = total_commission_earned - OLD.commission_amount,
        available_balance       = available_balance       - OLD.commission_amount,
        updated_at              = now()
    WHERE id = TRUE;
  END IF;

  RETURN NEW;
END;
$function$;