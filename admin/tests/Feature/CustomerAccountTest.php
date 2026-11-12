<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Tests\TestCase;

class CustomerAccountTest extends TestCase
{
    use RefreshDatabase;

    private function customer(): User
    {
        return User::factory()->create(['is_admin' => false, 'account_type' => 'customer', 'password' => 'Synthetic-customer-password-123']);
    }

    public function test_registration_creates_only_a_customer_and_uses_a_separate_guard(): void
    {
        Http::preventStrayRequests();
        $this->post('/account/register', ['name' => 'Customer', 'email' => 'CUSTOMER@example.test', 'password' => 'Synthetic-customer-password-123', 'password_confirmation' => 'Synthetic-customer-password-123', 'is_admin' => true, 'account_type' => 'staff'])
            ->assertRedirect('/account/orders');
        $user = User::firstOrFail();
        $this->assertSame('customer@example.test', $user->email);
        $this->assertFalse($user->is_admin);
        $this->assertSame('customer', $user->account_type);
        $this->assertAuthenticatedAs($user, 'customer');
        $this->assertGuest('web');
        $this->get('/admin/inventory')->assertRedirect('/admin/login');
        Http::assertNothingSent();
    }

    public function test_customer_login_cannot_authenticate_a_staff_or_disabled_staff_account(): void
    {
        $staff = User::factory()->create(['is_admin' => false, 'account_type' => 'staff', 'password' => 'Synthetic-customer-password-123']);
        $this->post('/account/login', ['email' => $staff->email, 'password' => 'Synthetic-customer-password-123'])->assertSessionHasErrors('email');
        $this->assertGuest('customer');
        $customer = $this->customer();
        $this->post('/account/login', ['email' => $customer->email, 'password' => 'Synthetic-customer-password-123'])->assertRedirect('/account/orders');
        $this->assertAuthenticatedAs($customer, 'customer');
        $this->post('/account/logout')->assertRedirect('/');
        $this->assertGuest('customer');
    }

    public function test_guests_are_redirected_to_customer_login_and_pages_are_not_cacheable(): void
    {
        $this->get('/account/orders')->assertRedirect('/account/login');
        $this->get('/account/collection')->assertRedirect('/account/login');
        $this->get('/account/register')->assertOk()->assertSee('Create your account')->assertHeader('X-Robots-Tag', 'noindex, nofollow');
        $this->assertStringContainsString('no-store', $this->get('/account/session')->headers->get('Cache-Control'));
    }

    public function test_customer_proxy_always_uses_session_identity_and_cannot_call_admin_mutations(): void
    {
        $user = $this->customer();
        $this->actingAs($user, 'customer');
        Http::preventStrayRequests();
        Http::fake(['http://127.0.0.1:3001/api/admin/customer' => Http::response(['orders' => []])]);
        $this->get('/account/orders?customerId=999')->assertOk()->assertSee('No orders yet');
        Http::assertSent(fn ($request): bool => $request['customerId'] === $user->id && $request['operation'] === 'orders' && $request->hasHeader('X-Toga-Admin-Key'));
        $this->post('/admin/ebay/connect')->assertForbidden();
    }

    public function test_checkout_is_linked_to_the_authenticated_customer_not_submitted_identity(): void
    {
        $user = $this->customer();
        $this->actingAs($user, 'customer');
        Http::preventStrayRequests();
        Http::fake(['http://127.0.0.1:3001/api/admin/customer' => Http::response(['url' => 'https://checkout.stripe.com/test'])]);
        $this->postJson('/account/checkout', ['items' => [['id' => 1, 'quantity' => 2]], 'customerId' => 999, 'email' => 'other@example.test'])->assertOk()->assertJsonPath('url', 'https://checkout.stripe.com/test');
        Http::assertSent(fn ($request): bool => $request['customerId'] === $user->id && $request['email'] === $user->email && $request['operation'] === 'checkout');
    }

    public function test_collection_counts_are_scoped_per_customer_and_do_not_mutate_shop_stock(): void
    {
        $first = $this->customer();
        $second = $this->customer();
        Http::preventStrayRequests();
        Http::fake(['http://127.0.0.1:3001/api/admin/customer' => Http::response(['products' => [['id' => 1, 'player' => 'Test Player', 'club' => 'Arsenal', 'number' => '1', 'variant' => 'Base', 'collection' => 'Test set', 'season' => '2026']]])]);
        $this->actingAs($first, 'customer')->post('/account/collection/1', ['owned' => 2, 'wanted' => 1, 'user_id' => $second->id])->assertRedirect();
        $this->assertDatabaseHas('customer_collection', ['user_id' => $first->id, 'card_id' => 1, 'owned' => 2, 'wanted' => 1]);
        $this->flushSession();
        $this->actingAs($second, 'customer')->get('/account/collection?view=owned')->assertOk()->assertSee('No matching cards');
        $this->flushSession();
        $this->actingAs($first, 'customer')->get('/account/collection?view=wanted')->assertOk()->assertSee('Test Player');
        $this->post('/account/collection/999', ['owned' => 1, 'wanted' => 0])->assertNotFound();
        $this->assertSame(1, DB::table('customer_collection')->count());
        Http::assertNotSent(fn ($request): bool => $request['operation'] !== 'catalogue');
    }

    public function test_customer_password_reset_is_single_use_and_cannot_reset_staff(): void
    {
        $user = $this->customer();
        $token = Password::createToken($user);
        $data = ['token' => $token, 'email' => $user->email, 'password' => 'New-synthetic-password-456', 'password_confirmation' => 'New-synthetic-password-456'];
        $this->post('/account/reset-password', $data)->assertRedirect('/account/login');
        $this->assertTrue(Hash::check($data['password'], $user->fresh()->password));
        $this->post('/account/reset-password', $data)->assertSessionHasErrors('email');
        $staff = User::factory()->create(['is_admin' => true, 'account_type' => 'staff']);
        $hash = $staff->password;
        $data['token'] = Password::createToken($staff);
        $data['email'] = $staff->email;
        $this->post('/account/reset-password', $data)->assertSessionHasErrors('email');
        $this->assertSame($hash, $staff->fresh()->password);
    }

    public function test_changing_password_requires_the_current_password_and_keeps_the_customer_signed_in(): void
    {
        $user = $this->customer();
        $this->actingAs($user, 'customer');
        $data = ['name' => 'Updated name', 'current_password' => 'wrong-password', 'password' => 'Updated-synthetic-password-789', 'password_confirmation' => 'Updated-synthetic-password-789'];
        $this->post('/account/profile', $data)->assertSessionHasErrors('current_password');
        $data['current_password'] = 'Synthetic-customer-password-123';
        $this->post('/account/profile', $data)->assertRedirect();
        $this->assertTrue(Hash::check($data['password'], $user->fresh()->password));
        $this->get('/account/profile')->assertOk()->assertSee('Updated name');
    }

    public function test_password_reset_does_not_log_reset_links_when_email_is_unconfigured(): void
    {
        Notification::fake();
        config(['mail.default' => 'log']);
        $user = $this->customer();
        $this->post('/account/forgot-password', ['email' => $user->email])->assertSessionHasErrors('email');
        Notification::assertNothingSent();
    }
}
