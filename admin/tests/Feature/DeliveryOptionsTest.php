<?php

namespace Tests\Feature;

use App\Filament\Pages\Delivery;
use App\Models\User;
use Filament\Facades\Filament;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Livewire\Livewire;
use Tests\TestCase;

class DeliveryOptionsTest extends TestCase
{
    use RefreshDatabase;

    public function test_staff_can_create_and_edit_delivery_services_with_prices_in_pence(): void
    {
        $this->actingAs(User::factory()->create(['is_admin' => true, 'account_type' => 'staff']));
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        Http::preventStrayRequests();
        Http::fake(['http://127.0.0.1:3001/api/admin/shipping' => Http::response(['options' => [['id' => 'service-1', 'name' => 'Tracked delivery', 'price' => 299, 'min_days' => 2, 'max_days' => 3, 'enabled' => 1]]])]);
        Livewire::test(Delivery::class)->callAction('addDelivery', data: ['name' => 'Express delivery', 'price' => 3.50, 'minDays' => 1, 'maxDays' => 2, 'enabled' => true])->assertHasNoActionErrors();
        Http::assertSent(fn ($request): bool => $request->method() === 'POST' && $request['price'] === 350 && $request['name'] === 'Express delivery' && $request['enabled'] === true);
        Livewire::test(Delivery::class)->callTableAction('editDelivery', 'service-1', data: ['name' => 'Tracked delivery', 'price' => 2.99, 'minDays' => 2, 'maxDays' => 3, 'enabled' => false])->assertHasNoTableActionErrors();
        Http::assertSent(fn ($request): bool => $request->method() === 'POST' && $request['id'] === 'service-1' && $request['price'] === 299 && $request['enabled'] === false);
    }
}
