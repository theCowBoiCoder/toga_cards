<?php

namespace App\Filament\Widgets;

use App\Services\InventoryClient;
use Filament\Widgets\Widget;

class SyncHealth extends Widget
{
    protected string $view = 'filament.widgets.sync-health';

    protected int|string|array $columnSpan = 'full';

    public function status(): array
    {
        return app(InventoryClient::class)->get('/api/admin/shop')['stockSync'];
    }
}
