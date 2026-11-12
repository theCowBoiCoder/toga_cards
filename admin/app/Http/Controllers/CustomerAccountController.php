<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Contracts\View\View;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class CustomerAccountController extends Controller
{
    public function form(string $form = 'login'): View
    {
        abort_unless(in_array($form, ['login', 'register', 'forgot-password'], true), 404);

        return view('customer.auth', ['form' => $form, 'token' => null]);
    }

    public function register(Request $request): RedirectResponse
    {
        if (is_string($request->input('email'))) {
            $request->merge(['email' => Str::lower(trim($request->input('email')))]);
        }
        $data = $request->validate(['name' => 'required|string|max:150', 'email' => 'required|email|max:254|unique:users,email', 'password' => 'required|string|min:12|max:128|confirmed']);
        $user = User::create([...$data, 'is_admin' => false, 'account_type' => 'customer']);
        Auth::guard('customer')->login($user);
        $request->session()->regenerate();

        return redirect()->route('customer.orders');
    }

    public function login(Request $request): RedirectResponse
    {
        $data = $request->validate(['email' => 'required|email', 'password' => 'required|string|max:128']);
        $data['email'] = Str::lower(trim($data['email']));
        if (! Auth::guard('customer')->attempt([...$data, 'is_admin' => false, 'account_type' => 'customer'], $request->boolean('remember'))) {
            throw ValidationException::withMessages(['email' => 'These details do not match a customer account.']);
        }
        $request->session()->regenerate();

        return redirect()->route('customer.orders');
    }

    public function logout(Request $request): RedirectResponse
    {
        Auth::guard('customer')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect('/');
    }

    public function session(): JsonResponse
    {
        $user = Auth::guard('customer')->user();

        return response()->json(['customer' => $user && ! $user->is_admin ? ['name' => $user->name] : null, 'csrf' => csrf_token()])->header('Cache-Control', 'no-store');
    }

    public function profile(): View
    {
        return view('customer.profile');
    }

    public function saveProfile(Request $request): RedirectResponse
    {
        $data = $request->validate(['name' => 'required|string|max:150', 'current_password' => 'required_with:password|nullable|current_password:customer', 'password' => 'nullable|string|min:12|max:128|confirmed']);
        $user = Auth::guard('customer')->user();
        abort_unless($user && $user->account_type === 'customer' && ! $user->is_admin, 403);
        $user->name = $data['name'];
        if (! empty($data['password'])) {
            $user->password = $data['password'];
            $user->remember_token = Str::random(60);
        }
        $user->save();
        $request->session()->regenerate();
        $request->session()->put('password_hash_customer', $user->getAuthPassword());

        return back()->with('status', 'Account details saved.');
    }

    public function forgot(Request $request): RedirectResponse
    {
        $request->validate(['email' => 'required|email']);
        if (in_array(config('mail.default'), ['log', 'array', 'failover', 'roundrobin'], true)) {
            return back()->withErrors(['email' => 'Password reset emails are not available yet. Please contact the shop.']);
        }
        $user = User::where('email', Str::lower(trim($request->input('email'))))->where('is_admin', false)->where('account_type', 'customer')->first();
        if ($user) {
            Password::sendResetLink(['email' => $user->email, 'is_admin' => false, 'account_type' => 'customer']);
        }

        return back()->with('status', 'If a customer account matches, a password reset link has been sent.');
    }

    public function resetForm(Request $request, string $token): View
    {
        return view('customer.auth', ['form' => 'reset-password', 'token' => $token]);
    }

    public function reset(Request $request): RedirectResponse
    {
        $data = $request->validate(['token' => 'required|string', 'email' => 'required|email', 'password' => 'required|string|min:12|max:128|confirmed']);
        $status = Password::reset([...$data, 'is_admin' => false, 'account_type' => 'customer'], function (User $user, string $password): void {
            abort_if($user->is_admin || $user->account_type !== 'customer', 403);
            $user->forceFill(['password' => Hash::make($password), 'remember_token' => Str::random(60)])->save();
            event(new PasswordReset($user));
        });

        return $status === Password::PASSWORD_RESET
            ? redirect()->route('customer.login')->with('status', 'Password changed. You can sign in now.')
            : back()->withErrors(['email' => __($status)]);
    }
}
