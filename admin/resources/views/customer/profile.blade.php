@extends('customer.layout')
@section('title', 'Account details')
@section('content')
<div class="auth panel"><h1>Account details</h1><p class="muted">{{ auth('customer')->user()->email }}</p><form method="post" action="{{ route('customer.profile') }}">@csrf
<label for="name">Name</label><input id="name" name="name" value="{{ old('name',auth('customer')->user()->name) }}" maxlength="150" required autocomplete="name">
<h2>Change password</h2><p class="muted">Leave these fields blank to keep your current password.</p>
<label for="current_password">Current password</label><input id="current_password" name="current_password" type="password" autocomplete="current-password">
<label for="password">New password</label><input id="password" name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password">
<label for="password_confirmation">Confirm new password</label><input id="password_confirmation" name="password_confirmation" type="password" autocomplete="new-password">
<p><button>Save account details</button></p></form></div>
@endsection
