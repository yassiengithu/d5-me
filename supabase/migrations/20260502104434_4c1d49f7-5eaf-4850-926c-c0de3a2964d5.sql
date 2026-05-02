INSERT INTO public.platform_earnings (id, total_commission_earned, available_balance)
VALUES (TRUE, 0, 0)
ON CONFLICT (id) DO NOTHING;