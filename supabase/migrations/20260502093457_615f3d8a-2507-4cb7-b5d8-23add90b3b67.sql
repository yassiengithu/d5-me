-- Add wallet columns to sellers
ALTER TABLE public.sellers
  ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_balance NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_earnings NUMERIC NOT NULL DEFAULT 0;

-- Update the seller totals trigger function to also maintain wallet balances
CREATE OR REPLACE FUNCTION public.apply_seller_totals_on_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  was_completed BOOLEAN := (TG_OP = 'UPDATE' AND OLD.status = 'completed');
  is_completed  BOOLEAN := (NEW.status = 'completed');
  was_pending_payment BOOLEAN := (TG_OP = 'UPDATE' AND OLD.payment_status = 'pending');
  is_paid        BOOLEAN := (NEW.payment_status = 'paid');
  target_seller  UUID := NEW.seller_id;
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
  ELSIF was_completed AND NOT is_completed THEN
    UPDATE public.sellers
    SET total_sales           = total_sales           - OLD.total_amount,
        total_commission_paid = total_commission_paid - OLD.commission_amount,
        net_earnings          = net_earnings          - OLD.seller_earnings,
        wallet_balance        = wallet_balance        - OLD.seller_earnings,
        total_earnings        = total_earnings        - OLD.seller_earnings
    WHERE user_id = OLD.seller_id;
  END IF;

  RETURN NEW;
END;
$function$;