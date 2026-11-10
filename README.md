# Insert Note

A note vending machine. Members leave a note with one thing they'd do with someone; another member inserts $1 and pulls it to get the name and contact inside.

- `index.html`, `app.js`: the machine
- `admin.html`: the admin portal (applications, members, every note)
- `config.js`: your Supabase project URL and anon key
- `supabase/schema.sql`: the database tables and access rules

## Setup

1. Create a free project at supabase.com.
2. In the project, open **SQL Editor**, paste all of `supabase/schema.sql`, and press **Run**.
3. In **Project Settings > API**, copy the Project URL and the `anon` public key into `config.js`.
4. Publish this folder with GitHub Pages (**Settings > Pages > Deploy from a branch > main, / (root)**).
5. In Supabase **Authentication > URL Configuration**, set the Site URL to your GitHub Pages address.
6. Open the site, apply to join with your own email, and confirm the email.
7. Back in the SQL Editor, make yourself the admin (use your email):

   ```sql
   update public.profiles set is_admin = true, status = 'approved' where email = 'you@example.com';
   ```

8. Open `admin.html` to approve everyone else.

## How access works

- Anyone can apply (email + password). New accounts are `pending` and see an empty machine.
- Only approved members can see, leave, or pull notes. Admins approve, decline, or block in the portal.
- A note's name and contact are stored separately and are readable only by its author, the member who pulled it, and admins.
- The $1 is pretend: no payment is taken.
