@extends('customer.layout')
@section('title', ucfirst(str_replace('-', ' ', $form)))
@section('content')
<div class="auth panel"><h1>{{ match($form) {'register' => 'Create your account', 'forgot-password' => 'Reset your password', 'reset-password' => 'Choose a new password', default => 'Welcome back'} }}</h1>
<p class="muted">Your orders, deliveries and collection in one place.</p>
<form method="post" action="{{ match($form) {'register' => route('customer.register'), 'forgot-password' => route('password.email'), 'reset-password' => route('password.update'), default => route('customer.login')} }}">@csrf
@if($form === 'register')<label for="name">Name</label><input id="name" name="name" value="{{ old('name') }}" maxlength="150" autocomplete="name" required>@endif
@if($token)<input type="hidden" name="token" value="{{ $token }}">@endif
<label for="email">Email address</label><input id="email" name="email" type="email" value="{{ old('email', request('email')) }}" autocomplete="email" maxlength="254" required>
@if($form !== 'forgot-password')<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="{{ $form === 'login' ? 'current-password' : 'new-password' }}" maxlength="128" @if($form !== 'login') minlength="12" @endif required>@endif
@if(in_array($form, ['register', 'reset-password']))<small class="muted">Use at least 12 characters.</small><label for="confirmation">Confirm password</label><input id="confirmation" name="password_confirmation" type="password" autocomplete="new-password" required>@endif
@if($form === 'login')<label><input name="remember" type="checkbox" value="1"> Remember me</label>@endif
<p><button type="submit">{{ match($form) {'register' => 'Create account', 'forgot-password' => 'Send reset link', 'reset-password' => 'Save password', default => 'Sign in'} }}</button></p></form>
@if($form === 'login')<p><a href="{{ route('password.request') }}">Forgot your password?</a></p><p>New here? <a href="{{ route('customer.register') }}">Create an account</a></p>@endif
</div>
@endsection
